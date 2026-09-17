/**
 * The MCP manager, against a real MCP server.
 *
 * It runs the echo server in src/testing over stdio through the official SDK, so
 * these exercise the actual protocol rather than a mock of what we assume it
 * does. The manager is the one place this product runs software it did not
 * write; a test built on our own assumptions would only check the assumptions.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "../config/config.js";
import { firstSentence, MCP_UNKNOWN, mcpDestination, mcpPreview } from "../tools/preview.js";
import type { Tool } from "../tools/tool.js";
import { capDescription, capSchema, fingerprint, McpManager } from "./manager.js";

// Plain JavaScript, so it runs under node with no extra toolchain.
const ECHO = resolve(import.meta.dirname, "..", "testing", "mcp-echo-server.mjs");
const canSpawn = existsSync(ECHO);

const managers: McpManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.stop();
});

function harness(
  servers: Record<string, unknown>,
  options: { deny?: string[]; backoffMs?: number } = {},
) {
  const config = ConfigSchema.parse({
    version: 1,
    mcp: { servers, deny: options.deny ?? [] },
  }).mcp;

  const registered = new Map<string, Tool>();
  const changes: unknown[] = [];

  const manager = new McpManager({
    config,
    connectTimeoutMs: 3_000,
    // A broken server is not retried here: these tests assert what one failure
    // looks like, and a retry loop would spawn processes for the whole run.
    autoReconnect: false,
    // Long by default so a failing server does not respawn in a loop for the
    // length of the test, leaving child processes behind and hanging the runner.
    backoffMinMs: options.backoffMs ?? 60_000,
    backoffMaxMs: options.backoffMs ?? 60_000,
    onToolsChanged: (c) => changes.push(c),
  });
  manager.wire(
    (tool) => registered.set(tool.name, tool),
    (name) => registered.delete(name),
  );
  managers.push(manager);
  return { manager, registered, changes };
}

function stdio(env: Record<string, string> = {}) {
  return { command: process.execPath, args: [ECHO], env };
}

/** The manager never blocks, so tests wait for a state rather than an await. */
/**
 * Waits for something a spawned MCP server has to do.
 *
 * Generous, because every one of these starts a real node process and completes
 * a handshake with it: on a shared Windows runner that has taken longer than
 * eight seconds while the code was doing exactly the right thing. The vitest
 * timeout is the real backstop; this one exists to fail with a message that says
 * what was being waited for.
 */
/**
 * Waits for something a spawned server has to do.
 *
 * The default budget is generous because the slow step is a Windows CI runner
 * starting a node process under load, which has taken over fifteen seconds
 * there. A passing test still finishes in under a second; the budget only
 * matters on the box where it is genuinely needed.
 *
 * The default `what` names the commonest wait rather than saying "a condition",
 * because the only thing a timeout message has to do is say which wait it was.
 */
async function until(
  check: () => boolean,
  ms = 30_000,
  what = "the server's tools to be registered",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
}

describe.skipIf(!canSpawn)("connecting to a server", () => {
  it("lists its tools and registers them under the server's name", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    expect([...registered.keys()].sort()).toEqual(["echo.echo", "echo.lookup"]);
    expect(manager.status()[0]?.state).toBe("ready");
  });

  it("marks every MCP tool as egress, whatever the server says", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    // Calling any of them sends the agent's input off this process. A server
    // claiming otherwise does not change that.
    for (const tool of registered.values()) expect(tool.egress).toBe(true);
  });

  it("takes readOnlyHint as read scope, and everything else as write", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    expect(registered.get("echo.lookup")?.scope).toBe("read");
    // No hint means it might do anything, so it needs the owner.
    expect(registered.get("echo.echo")?.scope).toBe("write");
  });

  it("actually calls the tool and returns what the server sent", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    const tool = registered.get("echo.echo") as Tool;
    const result = (await tool.run({ message: "hello" }, {
      agentId: "a",
      department: "d",
      runId: "r",
      signal: new AbortController().signal,
    } as never)) as Array<{ text: string }>;

    expect(JSON.parse(result[0]?.text as string)).toEqual({
      tool: "echo",
      args: { message: "hello" },
    });
  });

  it("caps a description the server made far too long", async () => {
    const { manager, registered } = harness({
      echo: stdio({ MCP_ECHO_LONG_DESCRIPTION: "1" }),
    });
    manager.start();
    await until(() => registered.size >= 2);

    const description = registered.get("echo.echo")?.description ?? "";
    expect(description.length).toBeLessThanOrEqual(1_000);
  });
});

describe.skipIf(!canSpawn)("a server that never answers", () => {
  it("is left unavailable with the reason, and never blocks the office", async () => {
    const { manager } = harness({ silent: stdio({ MCP_ECHO_SILENT: "1" }) });

    // start() returns without waiting: this is the whole point of it being fire
    // and forget, and a server on a slow network cannot hold the office closed.
    //
    // The bound is generous on purpose. What is being protected is that start()
    // does not wait on the connect, which takes CONNECT_TIMEOUT_MS — fifteen
    // seconds — so anything in the same order as a function call proves it. A
    // tighter figure measured the CI runner instead, and failed on Windows at
    // 384 ms while the code was doing exactly the right thing.
    const before = Date.now();
    manager.start();
    expect(Date.now() - before).toBeLessThan(2_000);

    await until(() => manager.status()[0]?.state === "unavailable", 10_000);
    expect(manager.status()[0]?.detail).toMatch(/did not answer/i);
  }, 15_000);
});

describe("a denied server", () => {
  it("is shown as denied and never started", async () => {
    const { manager, registered } = harness({ stripe: stdio() }, { deny: ["stripe"] });
    manager.start();
    await new Promise((done) => setTimeout(done, 400));

    expect(manager.status()[0]?.state).toBe("denied");
    expect(registered.size).toBe(0);
  });
});

describe("a server whose credentials never resolved", () => {
  it("says which variable to set rather than retrying forever", async () => {
    const { manager } = harness({
      notion: { command: "npx", args: ["-y", "server"], env: { NOTION_TOKEN: "$NOTION_TOKEN" } },
    });
    manager.start();
    await until(() => manager.status()[0]?.state === "unavailable");

    expect(manager.status()[0]?.detail).toContain("NOTION_TOKEN is not set");
    expect(manager.status()[0]?.detail).toContain("office/.env");
  });
});

describe("fingerprints", () => {
  it("change when a description changes, so a whitelist cannot be reused", () => {
    const before = fingerprint({ name: "search", description: "Searches.", inputSchema: {} });
    const after = fingerprint({ name: "search", description: "Searches, now.", inputSchema: {} });
    expect(after).not.toBe(before);
  });

  it("are stable for the same tool", () => {
    const tool = { name: "search", description: "Searches.", inputSchema: { type: "object" } };
    expect(fingerprint(tool)).toBe(fingerprint(tool));
  });
});

describe("caps", () => {
  it("drops an oversized schema rather than truncating it", () => {
    const huge = { type: "object", properties: { x: { enum: Array(20_000).fill("value") } } };
    const { schema, dropped } = capSchema(huge);
    expect(dropped).toBe(true);
    // Half a schema would be a lie about what the tool accepts.
    expect(schema).toEqual({ type: "object" });
  });

  it("keeps a schema that fits", () => {
    const small = { type: "object", properties: { q: { type: "string" } } };
    expect(capSchema(small)).toEqual({ schema: small, dropped: false });
  });

  it("marks a capped description so it does not look complete", () => {
    expect(capDescription("x".repeat(4000)).endsWith("…")).toBe(true);
    expect(capDescription("Short.")).toBe("Short.");
  });
});

describe("the approval card for someone else's server", () => {
  it("reduces an HTTP URL to its origin, dropping path and query", () => {
    // A path or query on an MCP endpoint often carries a tenant or a token, and
    // an approval card is the wrong place to print one.
    expect(mcpDestination("gmail", { url: "https://mcp.example.com/gmail/v2?tenant=acme" })).toBe(
      "gmail (MCP server at https://mcp.example.com)",
    );
  });

  it("shows only the basename of a stdio command", () => {
    expect(mcpDestination("notion", { command: "/usr/local/bin/npx" })).toBe(
      "notion (MCP server, npx)",
    );
  });

  it("says plainly that it cannot see what the server will do", () => {
    expect(MCP_UNKNOWN).toBe(
      "Staffroom cannot see what this server will do with these fields; approve only if you trust it.",
    );
  });

  it("takes the first sentence of a description, capped", () => {
    expect(firstSentence("Sends an email. Then files it.")).toBe("Sends an email.");
    expect(firstSentence("x".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});

describe.skipIf(!canSpawn)("a server that changes its tools", () => {
  it("reports what was added, removed and changed rather than absorbing it", async () => {
    const { manager, registered, changes } = harness({
      echo: stdio({ MCP_ECHO_SECOND_LIST: "1" }),
    });
    manager.start();
    await until(() => registered.size >= 2);
    changes.length = 0;

    // Asking again is what the discovery TTL does on a timer; doing it directly
    // keeps the test off the clock.
    await manager.reconnectTools("echo");
    await until(() => changes.length > 0, 15_000, "the tools-changed report");

    const change = changes[0] as {
      added: string[];
      removed: string[];
      changed: string[];
    };
    // The second listing drops echo, keeps lookup with a new description, and
    // adds one, so every direction of the diff has something in it.
    expect(change.removed).toContain("echo.echo");
    expect(change.added).toContain("echo.added_later");
    expect(change.changed).toContain("echo.lookup");

    // And a removed tool is actually withdrawn from the agents.
    expect(registered.has("echo.echo")).toBe(false);
    expect(registered.has("echo.added_later")).toBe(true);
  });
});

describe.skipIf(!canSpawn)("a tool call the server refuses", () => {
  it("surfaces the server's failure rather than swallowing it", async () => {
    const { manager, registered } = harness({ echo: stdio({ MCP_ECHO_FAIL_CALL: "1" }) });
    manager.start();
    await until(() => registered.size >= 2);

    const tool = registered.get("echo.echo") as Tool;
    await expect(
      tool.run({ message: "x" }, {
        agentId: "a",
        department: "d",
        runId: "r",
        signal: new AbortController().signal,
      } as never),
    ).rejects.toThrow();
  });

  it("refuses to call a server that is not connected", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);
    const tool = registered.get("echo.echo") as Tool;

    await manager.stop();
    await expect(
      tool.run({ message: "x" }, {
        agentId: "a",
        department: "d",
        runId: "r",
        signal: new AbortController().signal,
      } as never),
    ).rejects.toThrow(/not connected/i);
  });
});

describe.skipIf(!canSpawn)("applyConfig", () => {
  it("takes away the tools of a server that was removed", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    await manager.applyConfig({ servers: {}, deny: [], departments: {} });
    expect(registered.size).toBe(0);
  });

  it("denying a running server stops it and marks it denied", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    await manager.applyConfig({
      servers: { echo: stdio() as never },
      deny: ["echo"],
      departments: {},
    });

    expect(registered.size).toBe(0);
    expect(manager.status().find((s) => s.server === "echo")?.state).toBe("denied");
  });

  it("leaves an unchanged server alone", async () => {
    const server = stdio();
    const { manager, registered } = harness({ echo: server });
    manager.start();
    await until(() => registered.size >= 2);
    const listedAt = manager.status()[0]?.listedAt;

    await manager.applyConfig({ servers: { echo: server as never }, deny: [], departments: {} });
    await new Promise((done) => setTimeout(done, 200));

    // Same config, so it was never reconnected: the listing is the original one.
    expect(manager.status()[0]?.listedAt).toBe(listedAt);
    expect(registered.size).toBe(2);
  });
});

describe("signing in to a server", () => {
  it("refuses a server that is not a remote one", async () => {
    const { manager } = harness({ local: stdio() });
    const result = await manager.beginOAuth("local");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("not a remote");
  });

  it("refuses when the office has nowhere to keep a token", async () => {
    // Without an office folder there is no 0600 file to write, and a token held
    // only in memory would vanish on the next restart without saying so.
    const { manager } = harness({
      remote: { url: "https://mcp.example.com/x", auth: "oauth", headers: {} },
    });
    const result = await manager.beginOAuth("remote");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("cannot sign in");
  });

  it("does nothing for a callback naming a server it never started", async () => {
    const { manager } = harness({});
    expect(await manager.finishOAuth("notion", "a-code")).toBe(false);
  });
});

describe("the approval card's body", () => {
  it("shows the whole input, and marks the destination field editable", () => {
    const preview = mcpPreview({
      server: "gmail",
      description: "Sends an email.",
      config: { url: "https://mcp.example.com/x" },
      input: { to: "a@b.c", subject: "Hi" },
    });

    expect(preview.body).toContain("a@b.c");
    expect(preview.body).toContain("Hi");
    const field = (name: string): boolean | undefined =>
      preview.fields?.find((f: { name: string }) => f.name === name)?.editable;
    expect(field("to")).toBe(true);
    expect(field("subject")).toBe(false);
    expect(preview.irreversible).toBe(true);
  });

  it("says so plainly when there is no input at all", () => {
    const preview = mcpPreview({
      server: "notion",
      description: "Lists pages.",
      config: { command: "npx" },
      input: {},
    });
    expect(preview.body).toBe("(no input)");
  });

  it("falls back gracefully when the server config says nothing useful", () => {
    expect(mcpDestination("odd", {})).toBe("odd (MCP server)");
    expect(mcpDestination("odd", { url: "not a url" })).toBe("odd (MCP server)");
  });
});

describe("an HTTP server", () => {
  it("reports it as unavailable when nothing is listening, and keeps the office open", async () => {
    // Port 1 is reserved and nothing can be listening on it, so this exercises
    // the remote transport's failure path without depending on the network.
    const { manager, registered } = harness({
      remote: { url: "http://127.0.0.1:1/mcp", auth: "none", headers: {} },
    });
    manager.start();
    await until(() => {
      const state = manager.status()[0]?.state;
      return state === "unavailable" || state === "needs_auth";
    }, 10_000);

    expect(registered.size).toBe(0);
    expect(manager.status()[0]?.detail).toBeTruthy();
  }, 15_000);

  it("says which variable is missing when a bearer token never resolved", async () => {
    const { manager } = harness({
      remote: {
        url: "https://mcp.example.com/x",
        auth: "bearer",
        token: "$REMOTE_TOKEN",
        headers: {},
      },
    });
    manager.start();
    await until(() => manager.status()[0]?.state === "unavailable");

    expect(manager.status()[0]?.detail).toContain("REMOTE_TOKEN is not set");
  });

  it("says which header variable is missing too", async () => {
    const { manager } = harness({
      remote: {
        url: "https://mcp.example.com/x",
        auth: "none",
        headers: { "X-Tenant": "$TENANT_ID" },
      },
    });
    manager.start();
    await until(() => manager.status()[0]?.state === "unavailable");

    expect(manager.status()[0]?.detail).toContain("TENANT_ID is not set");
  });
});

describe("status", () => {
  it("is empty before anything starts", () => {
    const { manager } = harness({});
    expect(manager.status()).toEqual([]);
  });

  it("reports every server as stopped once the office closes", async () => {
    const { manager } = harness({
      a: { url: "https://example.invalid/a", auth: "none", headers: {} },
    });
    manager.start();
    await until(() => manager.status().length > 0);

    await manager.stop();
    expect(manager.status().every((s) => s.state === "stopped")).toBe(true);
  }, 20_000);

  it("does nothing when asked to re-list a server it does not have", async () => {
    const { manager } = harness({});
    await expect(manager.reconnectTools("nope")).resolves.toBeUndefined();
  });
});

describe("departments", () => {
  it("wires a server only to the pods it was given", async () => {
    const config = ConfigSchema.parse({
      version: 1,
      mcp: {
        servers: { echo: { command: process.execPath, args: [ECHO], env: {} } },
        departments: { echo: ["marketing"] },
      },
    }).mcp;

    const registered = new Map<string, Tool>();
    const manager = new McpManager({ config, connectTimeoutMs: 3_000, autoReconnect: false });
    manager.wire(
      (tool) => registered.set(tool.name, tool),
      (name) => registered.delete(name),
    );
    managers.push(manager);

    manager.start();
    await until(() => registered.size >= 2);

    // Absent means everywhere; present means exactly these.
    for (const tool of registered.values()) expect(tool.departments).toEqual(["marketing"]);
  });
});

describe.skipIf(!canSpawn)("stopping and restarting", () => {
  it("takes the tools away when a server is stopped, and brings them back", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    await manager.reconnect("echo");
    await until(() => registered.size >= 2);
    expect(manager.status().find((s) => s.server === "echo")?.state).toBe("ready");
  });

  it("reconnecting a server that was never configured does nothing", async () => {
    const { manager } = harness({});
    await expect(manager.reconnect("nope")).resolves.toBeUndefined();
  });

  it("can be stopped twice without complaint", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);
    await manager.stop();
    await expect(manager.stop()).resolves.toBeUndefined();
  });

  it("opens again when started after a stop", async () => {
    const { manager, registered } = harness({ echo: stdio() });
    manager.start();
    await until(() => registered.size >= 2);

    await manager.stop();
    expect(registered.size).toBe(0);

    // stop() means the office closed, not that this manager is spent: starting
    // it again is how an office reopens without rebuilding everything.
    manager.start();
    await until(() => registered.size >= 2);
    expect(manager.status().find((s) => s.server === "echo")?.state).toBe("ready");
  });
});

describe("applyConfig on servers that never connect", () => {
  it("adds a server that was not there before", async () => {
    const { manager } = harness({});
    await manager.applyConfig({
      servers: { remote: { url: "https://example.invalid/x", auth: "none", headers: {} } as never },
      deny: [],
      departments: {},
    });
    await until(() => manager.status().length > 0, 12_000);
    expect(manager.status()[0]?.server).toBe("remote");
  }, 20_000);

  it("brings a server back when it stops being denied", async () => {
    const { manager } = harness(
      { remote: { url: "https://example.invalid/x", auth: "none", headers: {} } },
      { deny: ["remote"] },
    );
    manager.start();
    expect(manager.status()[0]?.state).toBe("denied");

    await manager.applyConfig({
      servers: { remote: { url: "https://example.invalid/x", auth: "none", headers: {} } as never },
      deny: [],
      departments: {},
    });
    await until(() => manager.status()[0]?.state !== "denied", 12_000);
  }, 20_000);
});
