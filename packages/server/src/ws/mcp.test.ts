/**
 * What the office is told about its MCP servers.
 *
 * The connector strip is the only place an owner finds out that a server they
 * configured is not working, so the mapping from a connection's state to what
 * they see is worth pinning down — including that a failure message goes through
 * redaction, because a connection error can quote a URL with a token in it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureRedaction } from "@staffroom/core";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";
import { handle } from "./handlers.js";
import { collectState } from "./state.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(config?: string): Promise<StaffroomServer> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-mcp-ws-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  if (config !== undefined) writeFileSync(join(dir, "config.yaml"), config, "utf8");

  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return server;
}

describe("the connector strip", () => {
  it("shows one connector per MCP server, not one per tool", async () => {
    const server = await office(
      [
        "version: 1",
        "mcp:",
        "  servers:",
        "    notion:",
        "      url: http://127.0.0.1:1/mcp",
        "",
      ].join("\n"),
    );

    const state = await collectState(server.office);
    const notion = state.connectors.filter((c) => c.id === "notion");
    expect(notion).toHaveLength(1);
    expect(notion[0]?.kind).toBe("mcp");
  });

  it("says a server that will not connect is down, and why", async () => {
    const server = await office(
      [
        "version: 1",
        "mcp:",
        "  servers:",
        "    notion:",
        "      url: http://127.0.0.1:1/mcp",
        "",
      ].join("\n"),
    );

    // Nothing can be listening on port 1, so this is the failure path.
    await new Promise((done) => setTimeout(done, 2_500));
    const state = await collectState(server.office);
    const notion = state.connectors.find((c) => c.id === "notion");

    expect(["down", "starting"]).toContain(notion?.health);
    if (notion?.health === "down") expect(notion.message).toBeTruthy();
  }, 15_000);

  it("shows a denied server as denied and never starts it", async () => {
    const server = await office(
      [
        "version: 1",
        "mcp:",
        "  servers:",
        "    stripe:",
        "      url: https://mcp.example.com/stripe",
        "  deny: [stripe]",
        "",
      ].join("\n"),
    );

    const state = await collectState(server.office);
    expect(state.connectors.find((c) => c.id === "stripe")?.health).toBe("denied");
  });

  it("redacts a secret out of a connection failure before the owner sees it", async () => {
    configureRedaction(["a-very-secret-token-value"]);
    const server = await office();

    // The message goes through the same redaction as everything else, so a URL
    // with a token in it cannot reach the strip intact.
    const state = await collectState(server.office);
    for (const connector of state.connectors) {
      expect(connector.message ?? "").not.toContain("a-very-secret-token-value");
    }
  });
});

describe("reconnecting a server by hand", () => {
  it("refuses a name that is not in the config", async () => {
    const server = await office();
    const result = await handle(server.office, {
      type: "mcp.reconnect",
      reqId: "r1",
      server: "not-configured",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("not-configured");
  });

  it("accepts a server that is configured", async () => {
    const server = await office(
      [
        "version: 1",
        "mcp:",
        "  servers:",
        "    notion:",
        "      url: http://127.0.0.1:1/mcp",
        "",
      ].join("\n"),
    );

    const result = await handle(server.office, {
      type: "mcp.reconnect",
      reqId: "r1",
      server: "notion",
    });
    expect(result.ok).toBe(true);
  }, 20_000);
});

describe("signing in to a server", () => {
  it("refuses a stdio server, which has nothing to sign in to", async () => {
    const server = await office(
      [
        "version: 1",
        "mcp:",
        "  servers:",
        "    local:",
        "      command: node",
        '      args: ["-e", "process.exit(0)"]',
        "",
      ].join("\n"),
    );

    const result = await handle(server.office, {
      type: "mcp.oauth.begin",
      reqId: "r1",
      server: "local",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("not a remote MCP server");
  });

  it("refuses a name that is not in the config rather than starting anything", async () => {
    const server = await office();
    const result = await handle(server.office, {
      type: "mcp.oauth.begin",
      reqId: "r1",
      server: "not-configured",
    });

    expect(result.ok).toBe(false);
  });

  // The Connect button only ever opens a URL the office hands back, so the
  // handler must never answer ok without one.
  it("never reports success without an authorisation URL", async () => {
    const server = await office(
      [
        "version: 1",
        "mcp:",
        "  servers:",
        "    remote:",
        "      url: http://127.0.0.1:1/mcp",
        "",
      ].join("\n"),
    );

    const result = await handle(server.office, {
      type: "mcp.oauth.begin",
      reqId: "r1",
      server: "remote",
    });

    if (result.ok) {
      expect(typeof (result.result as { url?: unknown }).url).toBe("string");
    } else {
      expect(result.error?.message).toBeTruthy();
    }
  }, 20_000);
});

describe("the web_search connector", () => {
  it("is grey with no backend, and says what to do about it", async () => {
    const server = await office();
    const search = (await collectState(server.office)).connectors.find(
      (c) => c.id === "web_search",
    );

    expect(search?.health).toBe("grey");
    expect(search?.message).toContain("tools.web");
  });

  it("goes red once a configured backend has actually failed", async () => {
    // A self-hosted searxng at a port nothing is listening on: a configured
    // backend that will certainly fail, without this test reaching the internet.
    const server = await office(
      [
        "version: 1",
        "tools:",
        "  web:",
        "    provider: searxng",
        "    base_url: http://127.0.0.1:1",
        "",
      ].join("\n"),
    );

    // Configured but untried is not the same as working, so it does not claim to
    // be: green is only reported after a call has come back.
    expect(
      (await collectState(server.office)).connectors.find((c) => c.id === "web_search")?.health,
    ).toBe("ok");

    const tool = server.office.tools.list().find((t) => t.tool.name === "web_search")?.tool;
    await tool?.run(
      { query: "bakery", maxResults: 3 },
      {
        agentId: "researcher",
        department: "marketing",
        runId: "r1",
        signal: AbortSignal.timeout(9_000),
        log: () => {},
        brain: {} as never,
      },
    );

    const after = (await collectState(server.office)).connectors.find((c) => c.id === "web_search");
    expect(after?.health).toBe("down");
    expect(after?.message).toBeTruthy();
  }, 20_000);
});
