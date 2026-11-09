/**
 * Signing in to an MCP server that wants OAuth.
 *
 * The SDK does the protocol — PKCE with S256, discovery, the token exchange.
 * What lives here is everything that touches the owner's machine: where the
 * tokens are written, who is allowed to hand one back, and making sure the
 * values never reach a log or the run store.
 *
 * Two rules the tests hold this to:
 *
 *   A callback is only honoured if it carries a `state` we issued. Without that
 *   check any page the owner visits while the office is open could complete
 *   somebody else's sign-in against their office.
 *
 *   Tokens are files only the owner can read, and are registered for redaction
 *   the moment they are saved, not the next time the office starts.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addRedactionSecrets } from "../redact.js";

/**
 * Only the owner: the directory and the files in it.
 *
 * On Windows these are not enforced — NTFS has no POSIX mode bits, and chmod
 * there is close to a no-op. The file is still inside the owner's own office
 * folder, which on a normal install sits under their user profile and inherits
 * its ACL, but that is the operating system's protection rather than ours. Said
 * plainly here because a comment claiming 0600 on every platform would be a lie.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface StoredTokens {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  /** When we saved it, so an expiry can be judged. */
  saved_at?: number;
}

export function secretsDir(officeDir: string): string {
  return join(officeDir, ".staffroom", "secrets");
}

export function tokenPath(officeDir: string, server: string): string {
  // The server name comes from config.yaml, which the owner writes, but it ends
  // up in a path: anything that could climb out of the folder is refused.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(server)) {
    throw new Error(`"${server}" is not a usable MCP server name.`);
  }
  return join(secretsDir(officeDir), `mcp-${server}.json`);
}

/** Every token value in a saved file, for redaction. */
export function secretsOf(tokens: StoredTokens): string[] {
  return [tokens.access_token, tokens.refresh_token].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function saveTokens(officeDir: string, server: string, tokens: StoredTokens): void {
  const dir = secretsDir(officeDir);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // mkdir's mode is masked by umask, so it is set again explicitly.
  chmodSync(dir, DIR_MODE);

  const path = tokenPath(officeDir, server);
  writeFileSync(path, JSON.stringify({ ...tokens, saved_at: Date.now() }, null, 2), {
    mode: FILE_MODE,
  });
  chmodSync(path, FILE_MODE);

  // Registered now rather than at next startup: a token that reaches a log
  // before the office restarts is a token in a log.
  addRedactionSecrets(secretsOf(tokens));
}

export function loadTokens(officeDir: string, server: string): StoredTokens | undefined {
  const path = tokenPath(officeDir, server);
  if (!existsSync(path)) return undefined;
  try {
    const tokens = JSON.parse(readFileSync(path, "utf8")) as StoredTokens;
    addRedactionSecrets(secretsOf(tokens));
    return tokens;
  } catch {
    // A corrupt token file is the same as none: sign in again.
    return undefined;
  }
}

/** Reads every saved token so they are redacted from the moment the office opens. */
export function loadAllTokens(officeDir: string, servers: string[]): void {
  for (const server of servers) loadTokens(officeDir, server);
}

/**
 * The sign-ins currently in flight.
 *
 * A `state` is issued per attempt and is the only thing that makes a callback
 * ours. Entries expire, because a sign-in the owner abandoned should not leave
 * a usable slot open for the rest of the day.
 */
export class PendingAuthorizations {
  private readonly pending = new Map<string, { server: string; verifier?: string; at: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  issue(server: string): string {
    this.sweep();
    const state = randomBytes(32).toString("base64url");
    this.pending.set(state, { server, at: Date.now() });
    return state;
  }

  setVerifier(state: string, verifier: string): void {
    const entry = this.pending.get(state);
    if (entry !== undefined) entry.verifier = verifier;
  }

  /** Consumes the state: a callback can only ever be used once. */
  claim(state: string): { server: string; verifier?: string } | undefined {
    this.sweep();
    const entry = this.pending.get(state);
    if (entry === undefined) return undefined;
    this.pending.delete(state);
    return entry.verifier === undefined
      ? { server: entry.server }
      : { server: entry.server, verifier: entry.verifier };
  }

  /** The state most recently issued for a server, for the provider's callbacks. */
  latestFor(server: string): string | undefined {
    let found: { state: string; at: number } | undefined;
    for (const [state, entry] of this.pending) {
      if (entry.server !== server) continue;
      if (found === undefined || entry.at > found.at) found = { state, at: entry.at };
    }
    return found?.state;
  }

  size(): number {
    this.sweep();
    return this.pending.size;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [state, entry] of this.pending) {
      if (entry.at < cutoff) this.pending.delete(state);
    }
  }
}

export interface ProviderOptions {
  officeDir: string;
  server: string;
  /** Where the browser comes back to. Always loopback. */
  redirectUrl: string;
  pending: PendingAuthorizations;
  /** Called with the URL the owner has to visit. */
  onAuthorizationUrl: (url: URL) => void;
  /**
   * A client the owner registered with the provider themselves.
   *
   * Given, the SDK uses it and skips dynamic registration. Providers that do
   * not offer registration — Google's Gmail MCP server among them — cannot be
   * signed in to any other way.
   */
  client?: { client_id: string; client_secret?: string | undefined } | undefined;
}

/**
 * The SDK's OAuthClientProvider, backed by the office folder.
 *
 * `redirectToAuthorization` does not redirect: there is no browser here. It
 * hands the URL up so the office can show it, which is also what makes this
 * testable without one.
 */
export class OfficeOAuthProvider {
  private readonly options: ProviderOptions;
  private clientInfo: unknown;

  constructor(options: ProviderOptions) {
    this.options = options;
  }

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): {
    client_name: string;
    redirect_uris: string[];
    grant_types: string[];
    response_types: string[];
    token_endpoint_auth_method: string;
  } {
    return {
      client_name: "Staffroom",
      redirect_uris: [this.options.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // A client the owner registered has a secret and is a confidential
      // client; one we register dynamically is public and uses PKCE alone.
      token_endpoint_auth_method:
        this.options.client?.client_secret === undefined ? "none" : "client_secret_post",
    };
  }

  state(): string {
    return this.options.pending.issue(this.options.server);
  }

  clientInformation(): unknown {
    // The owner's own client wins: if they registered one, registering another
    // dynamically would sign them in as somebody else's app.
    return this.options.client ?? this.clientInfo;
  }

  saveClientInformation(information: unknown): void {
    this.clientInfo = information;
  }

  tokens(): StoredTokens | undefined {
    return loadTokens(this.options.officeDir, this.options.server);
  }

  saveTokens(tokens: StoredTokens): void {
    saveTokens(this.options.officeDir, this.options.server, tokens);
  }

  redirectToAuthorization(url: URL): void {
    this.options.onAuthorizationUrl(url);
  }

  saveCodeVerifier(verifier: string): void {
    const state = this.options.pending.latestFor(this.options.server);
    if (state !== undefined) this.options.pending.setVerifier(state, verifier);
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (this.verifier === undefined) throw new Error("No sign-in is in progress.");
    return this.verifier;
  }

  private verifier: string | undefined;
}
