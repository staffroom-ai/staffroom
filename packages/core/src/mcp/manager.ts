/**
 * Talking to MCP servers.
 *
 * This is the one place Staffroom runs and trusts software it did not write, so
 * the failure modes matter more than the happy path. Three rules shape all of it:
 *
 *   A server that will not start must never stop the office opening. It is shown
 *   as unavailable, with the reason, and the staff carry on without it.
 *
 *   Every MCP tool is `egress: true`. Whatever the server claims, calling it
 *   sends the agent's input to something outside this process.
 *
 *   A server can change its tools underneath you. Anything you allowed before is
 *   allowed for the tool as it was, so the fingerprint is recorded and a change
 *   is reported rather than absorbed.
 */

import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { McpConfig } from "../config/config.js";
import type { ApprovalPreview } from "../shared/types.js";
import { mcpPreview } from "../tools/preview.js";
import type { Tool } from "../tools/tool.js";
import { OfficeOAuthProvider, PendingAuthorizations } from "./oauth.js";

export type McpState = "connecting" | "ready" | "unavailable" | "denied" | "needs_auth" | "stopped";

export interface McpStatus {
  server: string;
  state: McpState;
  /** Why it is not ready, in words an owner can act on. */
  detail?: string | undefined;
  toolCount: number;
  /** When the tool list was last read. */
  listedAt?: number | undefined;
}

export interface McpToolsChanged {
  server: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface McpManagerOptions {
  config: McpConfig;
  /** Called whenever a server's tool list differs from the last one seen. */
  onToolsChanged?: (change: McpToolsChanged) => void;
  onStatus?: (status: McpStatus) => void;
  /** Overridable so tests do not wait fifteen seconds. */
  connectTimeoutMs?: number;
  /** How long a tool list is trusted before it is read again. */
  discoveryTtlMs?: number;
  /** Reconnect backoff bounds. */
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /**
   * Whether a dropped or failed server is retried. On by default: a laptop that
   * wakes up should find its tools back. Tests turn it off so a deliberately
   * broken server does not respawn for the length of the run.
   */
  autoReconnect?: boolean;
  /** Where OAuth tokens are kept. Without it a server cannot be signed in to. */
  officeDir?: string;
  /** The loopback URL an OAuth provider sends the browser back to. */
  oauthRedirectUrl?: string | undefined;
}

const CONNECT_TIMEOUT_MS = 15_000;
const DISCOVERY_TTL_MS = 15 * 60 * 1000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/** A server can describe its tools at any length; the prompt cannot afford it. */
const DESCRIPTION_MAX = 1_000;
/** Nor can it afford an arbitrarily large schema. */
const SCHEMA_MAX_BYTES = 16 * 1024;

/**
 * A minimal environment for a spawned server: enough to find its own binary and
 * write a temp file, and nothing else. Inheriting the office's whole environment
 * would hand every key in it to somebody else's program.
 */
function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "SystemRoot", "APPDATA"]) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** `$NOTION_TOKEN` that never resolved leaves the literal behind. */
function unresolved(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const match = value === undefined ? null : /^\$([A-Z0-9_]+)$/.exec(value);
    if (match !== null) return match[1];
  }
  return undefined;
}

export function fingerprint(tool: {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: tool.name,
        description: tool.description ?? "",
        schema: tool.inputSchema ?? {},
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export function capDescription(text: string | undefined): string {
  const value = (text ?? "").trim();
  if (value.length <= DESCRIPTION_MAX) return value;
  return `${value.slice(0, DESCRIPTION_MAX - 1)}…`;
}

/** An oversized schema is dropped rather than truncated: half a schema is a lie. */
export function capSchema(schema: unknown): { schema: unknown; dropped: boolean } {
  const encoded = JSON.stringify(schema ?? {});
  if (encoded.length <= SCHEMA_MAX_BYTES) return { schema: schema ?? {}, dropped: false };
  return { schema: { type: "object" }, dropped: true };
}

interface Connection {
  name: string;
  client?: Client | undefined;
  /** Kept so a server that ignores its stdin can still be stopped. */
  transport?: { close(): Promise<void>; pid?: number | null } | undefined;
  status: McpStatus;
  tools: Map<string, string>;
  timer?: NodeJS.Timeout | undefined;
  attempt: number;
  closed: boolean;
}

export class McpManager {
  private readonly options: McpManagerOptions;
  private readonly connections = new Map<string, Connection>();
  private config: McpConfig;
  /** Sign-ins in flight. The server claims from this when a browser comes back. */
  readonly pending = new PendingAuthorizations();
  private readonly providers = new Map<string, OfficeOAuthProvider>();
  private registerTool: (tool: Tool) => void = () => {};
  private unregisterTool: (name: string) => void = () => {};
  private stopped = false;

  constructor(options: McpManagerOptions) {
    this.options = options;
    this.config = options.config;
  }

  /**
   * Where an OAuth provider sends the owner's browser back.
   *
   * Set after the fact because it contains the port, and the office is built
   * before anything has listened. Until this was called, beginOAuth answered
   * "This office cannot sign in to servers." for every remote server — which it
   * did for every office ever started, because nothing called it.
   */
  setOauthRedirectUrl(url: string): void {
    this.options.oauthRedirectUrl = url;
  }

  /** The registry hands itself over here rather than being imported. */
  wire(register: (tool: Tool) => void, unregister: (name: string) => void): void {
    this.registerTool = register;
    this.unregisterTool = unregister;
  }

  status(): McpStatus[] {
    return [...this.connections.values()].map((c) => ({ ...c.status }));
  }

  /**
   * Starts every configured server without waiting for any of them. A server on
   * the other side of a slow network must not hold the office closed.
   */
  start(): void {
    this.stopped = false;
    for (const name of Object.keys(this.config.servers)) void this.open(name);
    for (const name of this.config.deny) this.markDenied(name);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const connection of this.connections.values()) {
      await this.teardown(connection);
      this.setStatus(connection, { state: "stopped" });
    }
  }

  /** Reconnects only what actually changed, so one edit does not restart them all. */
  async applyConfig(next: McpConfig): Promise<void> {
    const before = this.config;
    this.config = next;

    for (const name of Object.keys(before.servers)) {
      if (!(name in next.servers)) await this.close(name);
    }

    for (const [name, server] of Object.entries(next.servers)) {
      const changed = JSON.stringify(before.servers[name] ?? null) !== JSON.stringify(server);
      const nowDenied = next.deny.includes(name);
      const wasDenied = before.deny.includes(name);

      if (nowDenied) {
        if (!wasDenied) await this.close(name);
        this.markDenied(name);
        continue;
      }
      if (changed || wasDenied) {
        await this.close(name);
        void this.open(name);
      }
    }
  }

  /**
   * Reads a server's tool list again now, without dropping the connection.
   *
   * The discovery timer does this on its own schedule; this is for when
   * something has told us not to wait — a list_changed notification, an owner
   * pressing refresh, or a test that should not sit on a clock.
   */
  async reconnectTools(name: string): Promise<void> {
    const connection = this.connections.get(name);
    const server = this.config.servers[name];
    if (connection === undefined || server === undefined) return;
    await this.list(connection, server);
  }

  async reconnect(name: string): Promise<void> {
    await this.close(name);
    await this.open(name);
  }

  /**
   * Starts a sign-in and returns the URL the owner has to visit.
   *
   * Nothing is opened here: the office has no browser, and the CLI might be on a
   * machine with no display. The URL goes back to whoever asked.
   */
  async beginOAuth(
    name: string,
  ): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
    const server = this.config.servers[name];
    if (server === undefined || !("url" in server)) {
      return { ok: false, message: `${name} is not a remote MCP server.` };
    }
    const officeDir = this.options.officeDir;
    const redirectUrl = this.options.oauthRedirectUrl;
    if (officeDir === undefined || redirectUrl === undefined) {
      return { ok: false, message: "This office cannot sign in to servers." };
    }

    let authorizationUrl: URL | undefined;
    /*
     * A client the owner registered, when the provider does not do registration.
     *
     * Read from the server's own entry rather than from anywhere global: two
     * connectors can each have their own, and a client id is per provider.
     */
    const configured = server as { client_id?: string; client_secret?: string };
    const client =
      configured.client_id === undefined
        ? undefined
        : {
            client_id: configured.client_id,
            ...(configured.client_secret === undefined
              ? {}
              : { client_secret: configured.client_secret }),
          };

    const provider = new OfficeOAuthProvider({
      officeDir,
      server: name,
      redirectUrl,
      pending: this.pending,
      ...(client === undefined ? {} : { client }),
      onAuthorizationUrl: (url) => {
        authorizationUrl = url;
      },
    });
    this.providers.set(name, provider);

    try {
      const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
      await auth(provider as never, { serverUrl: server.url });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    if (authorizationUrl === undefined) {
      // Already authorised: the SDK found usable tokens and did not need a visit.
      await this.reconnect(name);
      return { ok: false, message: `${name} is already signed in.` };
    }
    return { ok: true, url: authorizationUrl.href };
  }

  /** Completes a sign-in with the code the provider sent back, then reconnects. */
  async finishOAuth(name: string, code: string): Promise<boolean> {
    const provider = this.providers.get(name);
    const server = this.config.servers[name];
    if (provider === undefined || server === undefined || !("url" in server)) return false;

    try {
      const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
      await auth(provider as never, { serverUrl: server.url, authorizationCode: code });
    } catch {
      return false;
    }

    await this.reconnect(name);
    return true;
  }

  private markDenied(name: string): void {
    const connection = this.connections.get(name) ?? this.blank(name);
    this.connections.set(name, connection);
    this.setStatus(connection, {
      state: "denied",
      detail: "You have denied this server, so the office never starts it.",
    });
  }

  private blank(name: string): Connection {
    return {
      name,
      status: { server: name, state: "connecting", toolCount: 0 },
      tools: new Map(),
      attempt: 0,
      closed: false,
    };
  }

  private setStatus(connection: Connection, patch: Partial<McpStatus>): void {
    connection.status = { ...connection.status, ...patch };
    this.options.onStatus?.({ ...connection.status });
  }

  private async close(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (connection === undefined) return;
    await this.teardown(connection);
    this.connections.delete(name);
  }

  /**
   * Ends a connection and makes sure the child process is actually gone.
   *
   * A server that ignores its stdin never notices a polite close, and the SDK
   * waits on it. So the close is given a short grace and then the process is
   * killed: an office that has been asked to stop must stop, and a stray server
   * holding a port or a file is worse than an abrupt exit.
   */
  private async teardown(connection: Connection): Promise<void> {
    connection.closed = true;
    if (connection.timer !== undefined) clearTimeout(connection.timer);
    for (const toolName of connection.tools.keys()) this.unregisterTool(toolName);
    connection.tools.clear();

    const client = connection.client;
    connection.client = undefined;
    if (client !== undefined) {
      try {
        await withTimeout(client.close(), 1_000, "close");
      } catch {
        // Unresponsive or already gone; the kill below settles it either way.
      }
    }

    const pid = connection.transport?.pid;
    if (typeof pid === "number") {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already exited.
      }
    }
    connection.transport = undefined;
  }

  private async open(name: string): Promise<void> {
    if (this.stopped) return;
    if (this.config.deny.includes(name)) {
      this.markDenied(name);
      return;
    }

    const server = this.config.servers[name];
    if (server === undefined) return;

    const connection = this.connections.get(name) ?? this.blank(name);
    connection.closed = false;
    this.connections.set(name, connection);
    this.setStatus(connection, { state: "connecting", detail: undefined });

    // A server whose credentials never resolved is not a failure to retry: it
    // needs the owner to put the value somewhere, and says which one.
    const missing =
      "url" in server
        ? unresolved([server.token, ...Object.values(server.headers)])
        : unresolved([...server.args, ...Object.values(server.env)]);
    if (missing !== undefined) {
      this.setStatus(connection, {
        state: "unavailable",
        detail: `${missing} is not set. Add it to office/.env and this server will connect.`,
      });
      return;
    }

    const client = new Client({ name: "staffroom", version: "0.1.1" });
    connection.client = client;

    const transport: { close(): Promise<void>; pid?: number | null } =
      "url" in server
        ? new StreamableHTTPClientTransport(new URL(server.url), {
            requestInit: {
              headers: {
                ...server.headers,
                ...(server.token === undefined ? {} : { Authorization: `Bearer ${server.token}` }),
              },
            },
          })
        : new StdioClientTransport({
            command: server.command,
            args: server.args,
            env: { ...baseEnv(), ...server.env },
            ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
          });

    connection.transport = transport;
    const deadline = this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;

    try {
      // The SDK's transport classes declare `sessionId?: string` where this
      // repository's exactOptionalPropertyTypes wants `string | undefined`. The
      // objects are correct; only the declaration disagrees, so the cast is
      // confined to this one call rather than loosening the setting repo-wide.
      await withTimeout(
        client.connect(transport as unknown as Parameters<Client["connect"]>[0]),
        deadline,
        "connect",
      );

      // The office can be told to stop while a slow server is still connecting.
      // Returning here without tearing down would leave a live client and an
      // orphaned child process behind for the lifetime of the machine.
      if (connection.closed) {
        await this.teardown(connection);
        return;
      }

      client.onclose = () => this.scheduleReconnect(name);
      await this.list(connection, server);
      if (connection.closed) {
        await this.teardown(connection);
        return;
      }
      connection.attempt = 0;

      // A server that says its list can change is asked again on a timer; one
      // that does not is still re-read, because servers are not always honest
      // about that.
      this.scheduleRelist(name, server);
    } catch (error) {
      if (connection.closed) return;
      const detail = error instanceof Error ? error.message : String(error);
      const needsAuth = detail.includes("401") || detail.includes("403");
      this.setStatus(connection, {
        state: needsAuth ? "needs_auth" : "unavailable",
        detail:
          detail === "connect timed out"
            ? `It did not answer within ${Math.round(deadline / 1000)} seconds.`
            : detail,
      });
      // Kill first, then close. A server that never answered will not answer a
      // shutdown either, so closing before killing leaves the close waiting on a
      // process that is never coming back, and its stdio pipes open behind it.
      const pid = transport.pid;
      if (typeof pid === "number") {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
      connection.client = undefined;
      connection.transport = undefined;
      try {
        await withTimeout(transport.close(), 500, "close");
      } catch {
        // Nothing to close, or it will not answer.
      }
      try {
        await withTimeout(client.close(), 500, "close");
      } catch {
        // Same.
      }
      // A server asking for credentials will keep asking. Retrying achieves
      // nothing until the owner has actually signed in, so we stop and wait.
      if (!needsAuth) this.scheduleReconnect(name);
    }
  }

  private scheduleRelist(name: string, server: unknown): void {
    const connection = this.connections.get(name);
    if (connection === undefined || connection.closed) return;
    const ttl = this.options.discoveryTtlMs ?? DISCOVERY_TTL_MS;
    const timer = setTimeout(() => {
      void this.list(connection, server).finally(() => this.scheduleRelist(name, server));
    }, ttl);
    timer.unref?.();
    connection.timer = timer;
  }

  /** Forever, with a ceiling: a laptop that wakes up should find its tools back. */
  private scheduleReconnect(name: string): void {
    const connection = this.connections.get(name);
    if (connection === undefined || connection.closed || this.stopped) return;
    if (this.options.autoReconnect === false) return;

    for (const toolName of connection.tools.keys()) this.unregisterTool(toolName);
    connection.tools.clear();
    this.setStatus(connection, { toolCount: 0 });

    const min = this.options.backoffMinMs ?? BACKOFF_MIN_MS;
    const max = this.options.backoffMaxMs ?? BACKOFF_MAX_MS;
    const wait = Math.min(max, min * 2 ** connection.attempt);
    connection.attempt += 1;

    if (connection.timer !== undefined) clearTimeout(connection.timer);
    const timer = setTimeout(() => void this.open(name), wait);
    timer.unref?.();
    connection.timer = timer;
  }

  /** Reads the tool list, registers what is there, and reports what moved. */
  private async list(connection: Connection, server: unknown): Promise<void> {
    const client = connection.client;
    if (client === undefined || connection.closed) return;

    let listed: Awaited<ReturnType<Client["listTools"]>>;
    try {
      listed = await client.listTools();
    } catch (error) {
      this.setStatus(connection, {
        state: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const before = new Map(connection.tools);
    const next = new Map<string, string>();
    const added: string[] = [];
    const changed: string[] = [];

    for (const entry of listed.tools) {
      const qualified = `${connection.name}.${entry.name}`;
      const print = fingerprint(entry);
      next.set(qualified, print);

      const previous = before.get(qualified);
      if (previous === undefined) added.push(qualified);
      else if (previous !== print) changed.push(qualified);

      if (previous === print) continue;
      this.register(connection.name, qualified, entry, server);
    }

    const removed = [...before.keys()].filter((name) => !next.has(name));
    for (const name of removed) this.unregisterTool(name);

    connection.tools = next;
    this.setStatus(connection, {
      state: "ready",
      detail: undefined,
      toolCount: next.size,
      listedAt: Date.now(),
    });

    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      this.options.onToolsChanged?.({ server: connection.name, added, removed, changed });
    }
  }

  private register(
    serverName: string,
    qualified: string,
    entry: {
      name: string;
      description?: string | undefined;
      inputSchema?: unknown;
      annotations?: unknown;
    },
    server: unknown,
  ): void {
    const annotations = (entry.annotations ?? {}) as { readOnlyHint?: boolean };
    const forceWrite = (this.config as { force_write?: string[] }).force_write ?? [];
    const readOnly = annotations.readOnlyHint === true && !forceWrite.includes(qualified);
    const { schema } = capSchema(entry.inputSchema);
    const description = capDescription(entry.description);

    // The schema is the server's, not ours, so it is validated as opaque JSON
    // rather than rebuilt as a zod type we would only get subtly wrong.
    const input = z.custom<Record<string, unknown>>(
      (value) => typeof value === "object" && value !== null,
      { message: "Expected an object." },
    );

    const tool: Tool = {
      name: qualified,
      description,
      input,
      scope: readOnly ? "read" : "write",
      // Always. Whatever the server says, calling it sends the input elsewhere.
      egress: true,
      departments: this.config.departments[serverName],
      preview: (value: unknown): ApprovalPreview =>
        mcpPreview({
          server: serverName,
          description,
          config: server,
          input: value,
        }),
      source: { kind: "mcp", server: serverName, schema },
      run: async (value: unknown) => {
        const connection = this.connections.get(serverName);
        const client = connection?.client;
        if (client === undefined) {
          throw new Error(`${serverName} is not connected.`);
        }
        const result = await client.callTool({
          name: entry.name,
          arguments: (value ?? {}) as Record<string, unknown>,
        });
        return result.content;
      },
    } as Tool;

    this.registerTool(tool);
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
