/**
 * Starting an office the way a first-time user does: a folder made by init, no
 * API key, nothing configured.
 */
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { boot, checkNodeVersion } from "./boot.js";
import { findDemoRuns, NO_TRANSCRIPTS, shouldUseDemo } from "./demo/demo.js";
import { createServer, type StaffroomServer } from "./index.js";
import type { ServerMessage } from "./ws/protocol.js";

const servers: StaffroomServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

/** Exactly what `npx staffroom init` produces. */
function freshOffice(options: { includeTools?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-fresh-"));
  copyTemplate("studio", dir, options);
  return dir;
}

describe("the node check", () => {
  it("says what to do rather than just refusing", () => {
    const message = checkNodeVersion("20.11.0") ?? "";
    expect(message).toContain("Node 22 or newer");
    expect(message).toContain("nodejs.org");
  });

  it("is happy on a supported version", () => {
    expect(checkNodeVersion("22.0.0")).toBeUndefined();
    expect(checkNodeVersion("24.14.1")).toBeUndefined();
  });
});

describe("demo mode", () => {
  it("turns on when nothing is configured", () => {
    expect(shouldUseDemo({ providerCount: 0, env: {} })).toBe(true);
  });

  it("stays off when a provider is configured, even a broken one", () => {
    // Otherwise the owner sees recorded work and believes it was real.
    expect(shouldUseDemo({ providerCount: 1, env: {} })).toBe(false);
  });

  it("can be asked for explicitly", () => {
    expect(shouldUseDemo({ providerCount: 3, demoFlag: true, env: {} })).toBe(true);
    expect(shouldUseDemo({ providerCount: 3, env: { STAFFROOM_DEMO: "1" } })).toBe(true);
  });

  it("finds the transcripts a copied office carries", () => {
    const dir = freshOffice();
    expect(findDemoRuns({ officeDir: dir })).toContain(".staffroom");
  });

  it("prefers the folder it was given", () => {
    const shipped = join(templateDir("studio"), "demo-runs");
    expect(findDemoRuns({ officeDir: freshOffice(), demoRunsDir: shipped })).toBe(shipped);
  });

  it("ignores a folder with no generic transcript, which cannot answer anything", () => {
    const empty = mkdtempSync(join(tmpdir(), "staffroom-empty-"));
    const dir = mkdtempSync(join(tmpdir(), "staffroom-office-"));
    expect(findDemoRuns({ officeDir: dir, demoRunsDir: empty })).toBeUndefined();
  });

  it("refuses to start with an instruction when there are no transcripts at all", async () => {
    const bare = mkdtempSync(join(tmpdir(), "staffroom-bare-"));
    writeFileSync(
      join(bare, "agents.yaml"),
      "version: 1\noffice:\n  name: X\n  timezone: UTC\nagents:\n  - id: only-one\n    department: ops\n    role: R\n    does: Does the one thing.\n",
      "utf8",
    );
    writeFileSync(join(bare, "config.yaml"), "version: 1\nproviders: {}\n", "utf8");
    mkdirSync(join(bare, "brain"), { recursive: true });

    await expect(boot({ officeDir: bare, log: () => undefined })).rejects.toThrow(NO_TRANSCRIPTS);
  });
});

describe("booting a fresh office", () => {
  it("opens in demo mode with no key, and nothing to fix", async () => {
    const dir = freshOffice();
    const { office, notices } = await boot({ officeDir: dir, log: () => undefined });

    expect(office.mode).toBe("demo");
    // A brand new office should have nothing for the owner to deal with.
    expect(notices).toEqual([]);
    expect(office.roster.officeName).toBe("Northlight Studio");
    expect(office.roster.departments.map((d) => d.id)).toEqual(["marketing", "finance", "sales"]);
    office.close();
  });

  it("closes off a run that was left running when the office stopped", async () => {
    const dir = freshOffice();
    const first = await boot({ officeDir: dir, log: () => undefined });
    const run = await first.office.store.create({
      id: "run_stranded",
      kind: "task",
      agentId: "copywriter",
      department: "marketing",
      model: { provider: "demo", model: "demo" },
      prompt: "left running",
      parentRunId: null,
      routineId: null,
      sample: false,
      createdAt: Date.now(),
    });
    await first.office.store.append(run.id, {
      type: "started",
      agentId: "copywriter",
      kind: "task",
      model: { provider: "demo", model: "demo" },
      modelSource: "office_default",
      prompt: "left running",
      parentRunId: null,
      routineId: null,
      systemPromptHash: "h",
      toolNames: [],
    });
    first.office.close();

    const second = await boot({ officeDir: dir, log: () => undefined });
    expect(second.notices.join(" ")).toContain("closed off");
    expect((await second.office.store.get("run_stranded"))?.status).toBe("failed");
    second.office.close();
  });

  it("expires an approval nobody can answer any more", async () => {
    const dir = freshOffice();
    const first = await boot({ officeDir: dir, log: () => undefined });
    const run = await first.office.store.create({
      id: "run_waiting",
      kind: "task",
      agentId: "copywriter",
      department: "marketing",
      model: { provider: "demo", model: "demo" },
      prompt: "waiting",
      parentRunId: null,
      routineId: null,
      sample: false,
      createdAt: Date.now(),
    });
    await first.office.store.append(run.id, {
      type: "approval_needed",
      approvalId: "apr_lost",
      toolCallId: "c1",
      tool: { name: "send_sms", source: { kind: "custom", file: "send-sms.ts" }, scope: "write" },
      input: {},
      preview: { action: "Send", destination: "x", summary: "s", body: "b", irreversible: true },
      requestedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });
    first.office.close();

    const second = await boot({ officeDir: dir, log: () => undefined });
    expect(second.notices.join(" ")).toContain("expired");
    await expect(second.office.store.pendingApprovals()).resolves.toEqual([]);
    second.office.close();
  });
});

describe("the first five minutes", () => {
  it("serves a working office from a folder init just made, with no key", async () => {
    const dir = freshOffice();
    const server = await createServer({ officeDir: dir, port: 0, watch: false });
    servers.push(server);

    const health = await (await fetch(`http://127.0.0.1:${server.port}/api/health`)).json();
    expect(health).toMatchObject({ ok: true, mode: "demo", office: "Northlight Studio" });

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { origin: `http://127.0.0.1:${server.port}`, host: `127.0.0.1:${server.port}` },
    });
    const received: ServerMessage[] = [];
    socket.on("message", (raw: Buffer) =>
      received.push(JSON.parse(raw.toString()) as ServerMessage),
    );
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });

    socket.send(JSON.stringify({ type: "hello", reqId: "h1", protocol: 1, token: server.token }));
    const waitFor = async <T extends ServerMessage["type"]>(
      type: T,
      match: (m: ServerMessage) => boolean = () => true,
    ): Promise<Extract<ServerMessage, { type: T }>> => {
      const started = Date.now();
      for (;;) {
        const found = received.find((m) => m.type === type && match(m));
        if (found !== undefined) return found as Extract<ServerMessage, { type: T }>;
        if (Date.now() - started > 15_000)
          throw new Error(`no ${type}: saw ${received.map((m) => m.type).join(",")}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    const welcome = await waitFor("welcome");
    expect(welcome.mode).toBe("demo");
    expect(welcome.state.agents).toHaveLength(4);
    expect(welcome.state.departments).toHaveLength(3);

    // The task from the README, with no model configured.
    socket.send(
      JSON.stringify({
        type: "task.create",
        reqId: "t1",
        department: "marketing",
        text: "Write a two-line tagline for a bakery",
      }),
    );
    const ack = await waitFor("ack", (m) => m.type === "ack" && m.reqId === "t1");
    const { runId } = ack.result as { runId: string };

    const done = await waitFor(
      "event",
      (m) => m.type === "event" && m.event.runId === runId && m.event.event.type === "done",
    );
    if (done.event.event.type === "done") {
      expect(done.event.event.deliverable.text.toLowerCase()).toContain("baked");
      // And it is a real file the owner can open.
      expect(done.event.event.deliverable.noteId).toContain("40-deliverables/marketing/");
    }

    const written = readdirSync(join(dir, "brain", "40-deliverables", "marketing"));
    expect(written.some((f) => f.includes("bakery"))).toBe(true);

    socket.close();
  });
});
