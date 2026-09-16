/**
 * Signing in to an MCP server.
 *
 * The protocol itself is the SDK's. What is tested here is everything that
 * touches the owner's machine, because that is what we would be blamed for:
 * where a token is written, who is allowed to complete a sign-in, and whether
 * the value can ever reach a log.
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRedaction, configureRedaction, redactSecrets } from "../redact.js";
import {
  loadAllTokens,
  loadTokens,
  OfficeOAuthProvider,
  PendingAuthorizations,
  saveTokens,
  secretsDir,
  secretsOf,
  tokenPath,
} from "./oauth.js";

const made: string[] = [];
function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-oauth-"));
  made.push(dir);
  return dir;
}

beforeEach(() => clearRedaction());
afterEach(() => {
  clearRedaction();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TOKENS = {
  access_token: "at-0123456789abcdefghijklmnop",
  token_type: "Bearer",
  refresh_token: "rt-0123456789abcdefghijklmnop",
};

const POSIX = process.platform !== "win32";

describe("where tokens are written", () => {
  // NTFS has no POSIX mode bits, so this can only be asserted where it is real.
  // On Windows the file relies on the ACL it inherits from the user's profile.
  it.skipIf(!POSIX)("is a file only the owner can read, in a folder only they can open", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);

    // A token readable by every process on the machine is not stored, it is
    // published.
    expect(statSync(tokenPath(dir, "notion")).mode & 0o777).toBe(0o600);
    expect(statSync(secretsDir(dir)).mode & 0o777).toBe(0o700);
  });

  it("writes the token inside the office folder, wherever it runs", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);
    expect(tokenPath(dir, "notion").startsWith(dir)).toBe(true);
    expect(existsSync(tokenPath(dir, "notion"))).toBe(true);
  });

  it("round-trips what it saved", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);
    const loaded = loadTokens(dir, "notion");
    expect(loaded?.access_token).toBe(TOKENS.access_token);
    expect(loaded?.refresh_token).toBe(TOKENS.refresh_token);
  });

  it("treats a corrupt file as no token rather than crashing the office", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);
    writeFileSync(tokenPath(dir, "notion"), "{ not json", "utf8");
    expect(loadTokens(dir, "notion")).toBeUndefined();
  });

  it("returns nothing for a server that has never been signed in to", () => {
    expect(loadTokens(office(), "never")).toBeUndefined();
  });

  it("refuses a server name that could climb out of the folder", () => {
    const dir = office();
    // The name comes from config.yaml, which the owner writes by hand.
    expect(() => tokenPath(dir, "../../etc/passwd")).toThrow(/not a usable/);
    expect(() => tokenPath(dir, "a/b")).toThrow(/not a usable/);
  });
});

describe("keeping tokens out of the logs", () => {
  it("redacts a token from the moment it is saved", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);

    // Not "next time the office starts": a token that reaches a log before then
    // is a token in a log.
    const line = `calling notion with ${TOKENS.access_token}`;
    expect(redactSecrets(line)).not.toContain(TOKENS.access_token);
  });

  it("redacts the refresh token too, not just the access token", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);
    expect(redactSecrets(`refresh=${TOKENS.refresh_token}`)).not.toContain(TOKENS.refresh_token);
  });

  it("redacts saved tokens again as soon as the office opens", () => {
    const dir = office();
    saveTokens(dir, "notion", TOKENS);
    clearRedaction();
    expect(redactSecrets(TOKENS.access_token)).toContain(TOKENS.access_token);

    loadAllTokens(dir, ["notion"]);
    expect(redactSecrets(TOKENS.access_token)).not.toContain(TOKENS.access_token);
  });

  it("does not lose the secrets that were already configured", () => {
    const dir = office();
    configureRedaction(["sk-ant-an-existing-key-value"]);
    saveTokens(dir, "notion", TOKENS);

    // Adding a token must not replace the keys from config.yaml.
    expect(redactSecrets("sk-ant-an-existing-key-value")).not.toContain("existing-key");
    expect(redactSecrets(TOKENS.access_token)).not.toContain(TOKENS.access_token);
  });

  it("lists every value worth hiding", () => {
    expect(secretsOf(TOKENS).sort()).toEqual([TOKENS.access_token, TOKENS.refresh_token].sort());
    expect(secretsOf({ access_token: "a-token-value-long", token_type: "Bearer" })).toEqual([
      "a-token-value-long",
    ]);
  });
});

describe("who is allowed to finish a sign-in", () => {
  it("only accepts a state it issued", () => {
    const pending = new PendingAuthorizations();
    const state = pending.issue("notion");

    // Without this check, any page the owner happens to visit while the office
    // is open could complete a sign-in against their office.
    expect(pending.claim("not-a-state-we-issued")).toBeUndefined();
    expect(pending.claim(state)?.server).toBe("notion");
  });

  it("lets a state be used exactly once", () => {
    const pending = new PendingAuthorizations();
    const state = pending.issue("notion");
    expect(pending.claim(state)).toBeDefined();
    expect(pending.claim(state)).toBeUndefined();
  });

  it("issues a different state every time", () => {
    const pending = new PendingAuthorizations();
    const states = new Set([1, 2, 3, 4, 5].map(() => pending.issue("notion")));
    expect(states.size).toBe(5);
    // Long enough that guessing one is not a strategy.
    for (const state of states) expect(state.length).toBeGreaterThanOrEqual(32);
  });

  it("forgets a sign-in the owner walked away from", () => {
    const pending = new PendingAuthorizations(-1);
    const state = pending.issue("notion");
    expect(pending.claim(state)).toBeUndefined();
    expect(pending.size()).toBe(0);
  });

  it("carries the code verifier through to the callback", () => {
    const pending = new PendingAuthorizations();
    const state = pending.issue("notion");
    pending.setVerifier(state, "the-verifier");
    expect(pending.claim(state)?.verifier).toBe("the-verifier");
  });

  it("ignores a verifier for a state that does not exist", () => {
    const pending = new PendingAuthorizations();
    expect(() => pending.setVerifier("nope", "v")).not.toThrow();
  });
});

describe("the provider the SDK drives", () => {
  it("hands the authorization URL up instead of trying to open a browser", () => {
    const dir = office();
    const pending = new PendingAuthorizations();
    const seen: URL[] = [];
    const provider = new OfficeOAuthProvider({
      officeDir: dir,
      server: "notion",
      redirectUrl: "http://127.0.0.1:4242/api/mcp/oauth/callback",
      pending,
      onAuthorizationUrl: (url) => seen.push(url),
    });

    provider.redirectToAuthorization(new URL("https://notion.example/authorize?x=1"));
    expect(seen[0]?.host).toBe("notion.example");
  });

  it("registers its redirect as the only one it will accept", () => {
    const provider = new OfficeOAuthProvider({
      officeDir: office(),
      server: "notion",
      redirectUrl: "http://127.0.0.1:4242/api/mcp/oauth/callback",
      pending: new PendingAuthorizations(),
      onAuthorizationUrl: () => {},
    });

    expect(provider.clientMetadata.redirect_uris).toEqual([
      "http://127.0.0.1:4242/api/mcp/oauth/callback",
    ]);
    expect(provider.redirectUrl).toContain("127.0.0.1");
  });

  it("binds the code verifier to the state it just issued", () => {
    const pending = new PendingAuthorizations();
    const provider = new OfficeOAuthProvider({
      officeDir: office(),
      server: "notion",
      redirectUrl: "http://127.0.0.1:4242/api/mcp/oauth/callback",
      pending,
      onAuthorizationUrl: () => {},
    });

    const state = provider.state();
    provider.saveCodeVerifier("verifier-abc");
    expect(pending.claim(state)?.verifier).toBe("verifier-abc");
    expect(provider.codeVerifier()).toBe("verifier-abc");
  });

  it("refuses to produce a verifier when no sign-in is in progress", () => {
    const provider = new OfficeOAuthProvider({
      officeDir: office(),
      server: "notion",
      redirectUrl: "http://127.0.0.1:4242/api/mcp/oauth/callback",
      pending: new PendingAuthorizations(),
      onAuthorizationUrl: () => {},
    });
    expect(() => provider.codeVerifier()).toThrow(/no sign-in/i);
  });

  it("reads tokens back through the same store the office uses", () => {
    const dir = office();
    const provider = new OfficeOAuthProvider({
      officeDir: dir,
      server: "notion",
      redirectUrl: "http://127.0.0.1:4242/api/mcp/oauth/callback",
      pending: new PendingAuthorizations(),
      onAuthorizationUrl: () => {},
    });

    expect(provider.tokens()).toBeUndefined();
    provider.saveTokens(TOKENS);
    expect(provider.tokens()?.access_token).toBe(TOKENS.access_token);
    if (POSIX) expect(statSync(tokenPath(dir, "notion")).mode & 0o777).toBe(0o600);
  });
});
