/**
 * The week 4 exit criterion: a WebSocket client is enough to watch a run happen,
 * approve what it asks for, and see it finish.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CompletionChunk,
  createOffice,
  type Office,
  type ProviderAdapter,
  type Tool,
  tool,
} from "@staffroom/core";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createServer, type StaffroomServer, splitRevise } from "./index.js";
import type { ServerMessage } from "./ws/protocol.js";

const AGENTS = `version: 1
office:
  name: Northlight Studio
  timezone: Australia/Melbourne
default_model: demo/demo
departments:
  marketing: Marketing
agents:
  - id: marketing-lead
    department: marketing
    name: Dana
    role: Marketing lead
    does: Takes a marketing task and picks who does it.
    lead: true
  - id: copywriter
    department: marketing
    name: Priya
    role: Copywriter
    does: Turns briefs into landing page copy.
    tools: [send_sms]
  - id: bookkeeper
    department: finance
    name: Sam
    role: Bookkeeper
    does: Categorises transactions and drafts summaries.
`;

function officeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-server-"));
  writeFileSync(join(dir, "agents.yaml"), AGENTS, "utf8");
  writeFileSync(join(dir, "config.yaml"), "version: 1\nproviders: {}\n", "utf8");
  mkdirSync(join(dir, "brain", "00-about"), { recursive: true });
  writeFileSync(
    join(dir, "brain", "00-about", "company.md"),
    "---\ntitle: About us\ncreated: 2026-01-01T00:00:00Z\n---\n\nA four-person studio.\n",
    "utf8",
  );
  return dir;
}

const text = (t: string): CompletionChunk => ({ type: "text", text: t });
const stop = (reason: "end" | "tool_calls" = "end"): CompletionChunk => ({
  type: "done",
  stopReason: reason,
  usage: { inputTokens: 10, outputTokens: 5 },
});
const call = (id: string, name: string, input: Record<string, unknown>): CompletionChunk => ({
  type: "tool_call",
  call: { id, name, input },
});

function adapter(turns: CompletionChunk[][]): ProviderAdapter {
  let i = 0;
  return {
    id: "demo",
    kind: "demo",
    defaultModel: () => "demo",
    capabilities: () => ({
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsForcedTool: true,
      maxContextTokens: null,
    }),
    complete: () => {
      const script = turns[Math.min(i++, turns.length - 1)] ?? [];
      return (async function* () {
        for (const c of script) yield c;
      })();
    },
    countTokens: () => Promise.resolve(0),
    pricing: () => null,
    listModels: () => Promise.resolve([]),
  };
}

const sendSms = (): Tool =>
  ({
    ...tool({
      name: "send_sms",
      description: "Send a text message.",
      input: z.object({ to: z.string(), body: z.string() }),
      scope: "write",
      run: async () => ({ sent: true }),
    }),
    egress: true,
    source: { kind: "custom", file: "send-sms.ts" },
  }) as Tool;

const servers: StaffroomServer[] = [];
const offices: Office[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const o of offices.splice(0)) o.close();
});

async function start(turns: CompletionChunk[][], tools: Tool[] = []): Promise<StaffroomServer> {
  const dir = officeDir();
  const office = await createOffice({
    officeDir: dir,
    adapters: new Map([["demo", adapter(turns)]]),
    skipCustomTools: true,
  });
  for (const t of tools) office.tools.register(t);
  offices.push(office);

  const server = await createServer({ officeDir: dir, port: 0, office });
  servers.push(server);
  return server;
}

/** A client that records everything the server pushed. */
class Client {
  readonly received: ServerMessage[] = [];
  private constructor(readonly socket: WebSocket) {}

  static async connect(server: StaffroomServer): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { origin: `http://127.0.0.1:${server.port}`, host: `127.0.0.1:${server.port}` },
    });
    const client = new Client(socket);
    socket.on("message", (raw: Buffer) =>
      client.received.push(JSON.parse(raw.toString()) as ServerMessage),
    );
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    return client;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Waits for the first message matching, so tests never sleep on a guess. */
  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    match: (m: ServerMessage) => boolean = () => true,
    timeoutMs = 8000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const started = Date.now();
    for (;;) {
      const found = this.received.find((m) => m.type === type && match(m));
      if (found !== undefined) return found as Extract<ServerMessage, { type: T }>;
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `no ${type} after ${timeoutMs}ms; saw ${this.received.map((m) => m.type).join(", ")}`,
        );
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async hello(server: StaffroomServer, resumeFrom?: number): Promise<void> {
    this.send({
      type: "hello",
      reqId: "h1",
      protocol: 1,
      token: server.token,
      ...(resumeFrom === undefined ? {} : { resumeFrom }),
    });
    await this.waitFor("welcome");
  }

  close(): void {
    this.socket.close();
  }
}

describe("http", () => {
  it("reports health with the office's own name", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mode: "live",
      office: "Northlight Studio",
    });
  });

  it("puts the token in the page rather than the URL bar", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const html = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    expect(html).toContain(`content="${server.token}"`);
  });

  it("serves a note from the brain", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const response = await fetch(
      `http://127.0.0.1:${server.port}/api/brain/file?path=00-about/company.md`,
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("A four-person studio.");
  });

  it("refuses every way of asking for a file outside the brain", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    for (const path of [
      "../.env",
      "..%2F.env",
      "/etc/passwd",
      "00-about/../../.env",
      "company.exe",
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/brain/file?path=${encodeURIComponent(path)}`,
      );
      expect(response.status, path).toBe(404);
    }
  });
});

describe("auth", () => {
  it("refuses a request from another origin", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a request claiming another host", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    // Raw http, because fetch overrides a custom Host header with the real one and
    // would never exercise the check this test exists for.
    const status = await new Promise<number>((done, fail) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/api/health",
          method: "GET",
          headers: { host: "evil.example" },
        },
        (response) => {
          response.resume();
          done(response.statusCode ?? 0);
        },
      );
      request.on("error", fail);
      request.end();
    });
    expect(status).toBe(403);
  });

  it("refuses a websocket upgrade from another origin", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { origin: "https://evil.example" },
    });
    await expect(
      new Promise((_, fail) => {
        socket.once("error", fail);
        socket.once("open", () => fail(new Error("it opened")));
      }),
    ).rejects.toThrow(/403|Unexpected server response/);
  });

  it("closes a socket that says hello with the wrong token", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    const closed = new Promise<number>((done) => client.socket.once("close", done));
    client.send({ type: "hello", reqId: "h1", protocol: 1, token: "not-the-token" });
    await expect(closed).resolves.toBe(4401);
  });

  it("closes a socket that skips hello", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    const closed = new Promise<number>((done) => client.socket.once("close", done));
    client.send({ type: "ping", reqId: "p1" });
    await expect(closed).resolves.toBe(4401);
  });
});

describe("welcome", () => {
  it("sends the office the browser renders from", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    client.send({ type: "hello", reqId: "h1", protocol: 1, token: server.token });

    const welcome = await client.waitFor("welcome");
    expect(welcome).toMatchObject({ reqId: "h1", protocol: 1, mode: "live", resumed: false });
    expect(welcome.state).toMatchObject({
      version: 1,
      officeName: "Northlight Studio",
      timezone: "Australia/Melbourne",
    });
    // Three agents across two departments, pods in file order.
    expect(welcome.state.departments.map((d) => d.id)).toEqual(["marketing", "finance"]);
    expect(welcome.state.departments.map((d) => d.pod)).toEqual([0, 1]);
    expect(welcome.state.agents).toHaveLength(3);
    expect(welcome.state.agents.find((a) => a.id === "copywriter")).toMatchObject({
      seat: 1,
      status: "idle",
      name: "Priya",
    });
    // web_search is registered but unconfigured, and says so.
    expect(welcome.state.connectors.find((c) => c.id === "web_search")).toMatchObject({
      health: "grey",
    });
    client.close();
  });

  it("omits the brain tools from an agent's list, because everyone has them", async () => {
    const server = await start([[text("# T\n\nb"), stop()]], [sendSms()]);
    const client = await Client.connect(server);
    await client.hello(server);
    const welcome = await client.waitFor("welcome");
    const priya = welcome.state.agents.find((a) => a.id === "copywriter");
    expect(priya?.tools).toEqual(["send_sms"]);
    client.close();
  });
});

describe("the worked exchange", () => {
  it("runs a task, waits for the owner, and finishes when they approve", async () => {
    const server = await start(
      [
        [
          call("route_1", "assign_task", { agent_id: "copywriter", brief: "Text the client." }),
          stop("tool_calls"),
        ],
        [
          call("c1", "send_sms", { to: "+61400000000", body: "Your order is ready." }),
          stop("tool_calls"),
        ],
        [text("# Sent\n\nI let them know."), stop()],
      ],
      [sendSms()],
    );

    const client = await Client.connect(server);
    await client.hello(server);

    client.send({
      type: "task.create",
      reqId: "t1",
      department: "marketing",
      text: "Tell the client it is ready",
    });
    const ack = await client.waitFor("ack", (m) => m.type === "ack" && m.reqId === "t1");
    const { runId } = ack.result as { runId: string; routeRunId: string };
    expect(runId).toMatch(/^run_/);

    // The office asks before anything leaves the machine.
    const asking = await client.waitFor(
      "state",
      (m) => m.type === "state" && m.state.approvals.length > 0,
    );
    const approval = asking.state.approvals[0];
    expect(approval).toMatchObject({
      agentName: "Priya",
      tool: { name: "send_sms", source: "custom", scope: "write" },
    });
    // And shows exactly what would be sent.
    expect(approval?.preview.body).toContain("Your order is ready.");
    expect(approval?.preview.irreversible).toBe(true);

    client.send({
      type: "approval.decide",
      reqId: "a1",
      approvalId: approval?.id,
      decision: "approve",
    });
    await client.waitFor("ack", (m) => m.type === "ack" && m.reqId === "a1");

    // The run finishes, and the event stream says the owner approved.
    await client.waitFor(
      "event",
      (m) => m.type === "event" && m.event.event.type === "done" && m.event.runId === runId,
    );
    const resolved = client.received.find(
      (m) => m.type === "event" && m.event.event.type === "approval_resolved",
    );
    expect(resolved).toBeDefined();
    if (resolved?.type === "event" && resolved.event.event.type === "approval_resolved") {
      expect(resolved.event.event).toMatchObject({ decision: "approve", by: "owner" });
    }
    client.close();
  });

  it("returns the owner's refusal, with their note, to the agent", async () => {
    const server = await start(
      [
        [
          call("route_1", "assign_task", { agent_id: "copywriter", brief: "Text them." }),
          stop("tool_calls"),
        ],
        [call("c1", "send_sms", { to: "+61400000000", body: "hi" }), stop("tool_calls")],
        [text("# Stopped\n\nYou declined it."), stop()],
      ],
      [sendSms()],
    );

    const client = await Client.connect(server);
    await client.hello(server);
    client.send({ type: "task.create", reqId: "t1", department: "marketing", text: "text them" });

    const asking = await client.waitFor(
      "state",
      (m) => m.type === "state" && m.state.approvals.length > 0,
    );
    client.send({
      type: "approval.decide",
      reqId: "a1",
      approvalId: asking.state.approvals[0]?.id,
      decision: "deny",
      note: "wrong number",
    });
    await client.waitFor("ack", (m) => m.type === "ack" && m.reqId === "a1");

    const resolved = await client.waitFor(
      "event",
      (m) => m.type === "event" && m.event.event.type === "approval_resolved",
    );
    if (resolved.event.event.type === "approval_resolved") {
      expect(resolved.event.event).toMatchObject({
        decision: "deny",
        by: "owner",
        note: "wrong number",
      });
    }

    const toolResult = client.received.find(
      (m) => m.type === "event" && m.event.event.type === "tool_result",
    );
    if (toolResult?.type === "event" && toolResult.event.event.type === "tool_result") {
      expect(toolResult.event.event.output).toBe("The owner declined this action.");
    }
    client.close();
  });

  it("says so when an approval was already answered", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    await client.hello(server);

    client.send({
      type: "approval.decide",
      reqId: "a1",
      approvalId: "apr_nothing",
      decision: "approve",
    });
    const error = await client.waitFor("error", (m) => m.type === "error" && m.reqId === "a1");
    expect(error).toMatchObject({
      code: "APPROVAL_NOT_PENDING",
      hint: "This approval was already answered or has expired.",
    });
    client.close();
  });
});

describe("other handlers", () => {
  it("cancels a run", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    await client.hello(server);
    client.send({ type: "task.cancel", reqId: "c1", runId: "run_nothing" });
    const ack = await client.waitFor("ack", (m) => m.type === "ack" && m.reqId === "c1");
    expect(ack.result).toEqual({ cancelled: false });
    client.close();
  });

  it("replays a run's events for a tab that just opened it", async () => {
    const server = await start([
      [call("route_1", "assign_task", { agent_id: "copywriter", brief: "b" }), stop("tool_calls")],
      [text("# T\n\nbody"), stop()],
    ]);
    const client = await Client.connect(server);
    await client.hello(server);

    client.send({ type: "task.create", reqId: "t1", department: "marketing", text: "go" });
    const ack = await client.waitFor("ack", (m) => m.type === "ack" && m.reqId === "t1");
    const { runId } = ack.result as { runId: string };
    await client.waitFor(
      "event",
      (m) => m.type === "event" && m.event.event.type === "done" && m.event.runId === runId,
    );

    client.send({ type: "runs.replay", reqId: "r1", runId });
    const replay = await client.waitFor("replay", (m) => m.type === "replay" && m.reqId === "r1");
    expect(replay.done).toBe(true);
    expect(replay.events.map((e) => e.event.type)).toContain("started");
    client.close();
  });

  it("answers a ping", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    await client.hello(server);
    client.send({ type: "ping", reqId: "p1" });
    await expect(
      client.waitFor("pong", (m) => m.type === "pong" && m.reqId === "p1"),
    ).resolves.toBeDefined();
    client.close();
  });

  it("says plainly that a later feature is not here yet", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    await client.hello(server);
    client.send({ type: "brain.graph.get", reqId: "g1" });
    const error = await client.waitFor("error", (m) => m.type === "error" && m.reqId === "g1");
    expect(error.hint).toBe("Not available in this version.");
    client.close();
  });

  it("searches the brain", async () => {
    const server = await start([[text("# T\n\nb"), stop()]]);
    const client = await Client.connect(server);
    await client.hello(server);
    client.send({ type: "brain.search", reqId: "s1", query: "studio" });
    const ack = await client.waitFor("ack", (m) => m.type === "ack" && m.reqId === "s1");
    expect((ack.result as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    client.close();
  });
});

describe("revise", () => {
  it("treats a leading revise: as a revision, whatever the casing", () => {
    expect(splitRevise("Revise: shorter")).toEqual({ isRevise: true, instructions: "shorter" });
    expect(splitRevise("revise:shorter")).toEqual({ isRevise: true, instructions: "shorter" });
    expect(splitRevise("REVISE:  make it shorter")).toEqual({
      isRevise: true,
      instructions: "make it shorter",
    });
  });

  it("leaves an ordinary message alone", () => {
    expect(splitRevise("please revise: later")).toEqual({
      isRevise: false,
      instructions: "please revise: later",
    });
  });
});
