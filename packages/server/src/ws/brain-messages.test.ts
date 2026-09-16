/**
 * What the office tells the browser about the brain.
 *
 * The acceptance for SR-061 is about timing and about honesty. A note the owner
 * writes in Obsidian has to show up without a reload, or the promise that these
 * are ordinary files they own quietly stops being true. And a pinned note that
 * fell out of the budget has to be said out loud, because the pinned set is the
 * only context every agent gets without asking: losing one silently is an agent
 * working without something the owner believed it had.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createServer, type StaffroomServer } from "../index.js";
import { OfficeWatchers } from "../watch/index.js";
import { noteWarningMessage, pinnedTruncatedWarning } from "./brain-warnings.js";
import type { ServerMessage } from "./protocol.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
const watchers: OfficeWatchers[] = [];

afterEach(async () => {
  for (const w of watchers.splice(0)) await w.close();
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{ server: StaffroomServer; dir: string; brainDir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-brainws-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return { server, dir, brainDir: join(dir, "brain") };
}

/** A tab, recording everything the office pushed to it. */
class Client {
  readonly received: ServerMessage[] = [];
  private constructor(readonly socket: WebSocket) {}

  static async open(server: StaffroomServer): Promise<Client> {
    const origin = `http://127.0.0.1:${server.port}`;
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { origin, host: `127.0.0.1:${server.port}` },
    });
    const client = new Client(socket);
    socket.on("message", (raw: Buffer) =>
      client.received.push(JSON.parse(raw.toString()) as ServerMessage),
    );
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    client.send({ type: "hello", reqId: "hello", protocol: 1, token: server.token });
    await client.waitFor("welcome");
    return client;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    match: (m: ServerMessage) => boolean = () => true,
    timeoutMs = 8_000,
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
}

const connect = (server: StaffroomServer): Promise<Client> => Client.open(server);

function note(title: string, body: string): string {
  return `---\ntitle: ${title}\ncreated: 2026-03-04T09:00:00+11:00\n---\n\n${body}\n`;
}

describe("a note written by hand", () => {
  it("is announced with its edges, without a reload", async () => {
    const { server, dir, brainDir } = await office();

    const pushed: unknown[] = [];
    // The office's own hub, watched rather than replaced: the thing under test
    // is what a browser attached to this office would actually receive.
    const hub = server.hub;
    const original = Reflect.get(hub, "push") as (m: unknown) => void;
    Reflect.set(hub, "push", (message: unknown) => {
      pushed.push(message);
      original.call(hub, message);
    });

    const watcher = new OfficeWatchers({
      officeDir: dir,
      office: server.office,
      onEvent: (event) => {
        if (event.type !== "brain.changed") return;
        if (event.removed) hub.broadcastNoteRemoved(event.noteId);
        else hub.broadcastNoteIndexed(event.noteId);
      },
      debounceMs: 20,
    });
    watchers.push(watcher);
    watcher.start();
    // Chokidar's first scan has to finish before it can notice anything. The
    // second the acceptance is about starts at the write below, not here.
    await new Promise((done) => setTimeout(done, 400));

    mkdirSync(join(brainDir, "50-meetings"), { recursive: true });
    writeFileSync(
      join(brainDir, "50-meetings", "2026-03-04-standup.md"),
      note("Standup", "We talked about [[00-about/pricing]]."),
      "utf8",
    );

    // The acceptance figure is one second. Waiting longer would let a change
    // that is actually too slow pass.
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      if (pushed.some((m) => (m as { type: string }).type === "brain.note.indexed")) break;
      await new Promise((done) => setTimeout(done, 20));
    }

    const indexed = pushed.find((m) => (m as { type: string }).type === "brain.note.indexed") as
      | { node: { id: string }; edges: Array<{ to: string; kind: string }> }
      | undefined;

    expect(indexed?.node.id).toBe("50-meetings/2026-03-04-standup");
    // Its arrows come with it, or the graph would show a note floating free.
    expect(indexed?.edges).toContainEqual({
      from: "50-meetings/2026-03-04-standup",
      to: "00-about/pricing",
      kind: "link",
    });
  }, 20_000);
});

describe("the wording of a warning", () => {
  it("says what happened to the note, not just what is wrong with it", () => {
    const message = noteWarningMessage({
      scope: "note",
      id: "50-meetings/notes",
      reason: "invalid_front_matter",
    });

    expect(message).toContain("50-meetings/notes");
    // The reassurance matters as much as the diagnosis: in every one of these
    // cases the note was indexed anyway, and the owner should not think their
    // writing was thrown away.
    expect(message).toContain("still searchable");
  });

  it("names the notes an agent did not get to see", () => {
    const warning = pinnedTruncatedWarning(["00-about/company", "00-about/pricing"]);

    expect(warning.scope).toBe("pinned");
    expect(warning.message).toContain("00-about/company");
    expect(warning.message).toContain("00-about/pricing");
    // And what to do about it, since "over budget" alone is not actionable.
    expect(warning.message).toContain("pinned_token_budget");
  });

  it("still says something useful about a reason it has no words for", () => {
    const message = noteWarningMessage({
      scope: "note",
      id: "a/b",
      reason: "something_new" as never,
    });
    expect(message).toContain("a/b");
    expect(message).toContain("indexed anyway");
  });
});

describe("asking for the graph", () => {
  it("answers the tab that asked, and nobody else", async () => {
    const { server } = await office();
    const asker = await connect(server);
    const bystander = await connect(server);

    asker.send({ type: "brain.graph.get", reqId: "g1" });
    const graph = await asker.waitFor("brain.graph");

    expect(graph.reqId).toBe("g1");
    expect(graph.graph.nodes.length).toBeGreaterThan(0);
    // A whole snapshot of the brain, sent because one person opened a panel,
    // has no business arriving in a tab that is looking at something else.
    expect(bystander.received.some((m) => m.type === "brain.graph")).toBe(false);

    asker.socket.close();
    bystander.socket.close();
  }, 20_000);

  it("leaves read edges out unless they were asked for", async () => {
    const { server } = await office();
    const client = await connect(server);

    client.send({ type: "brain.graph.get", reqId: "quiet" });
    const quiet = await client.waitFor(
      "brain.graph",
      (m) => (m as { reqId: string }).reqId === "quiet",
    );
    expect(quiet.graph.edges.filter((e) => e.kind === "read")).toEqual([]);

    client.send({ type: "brain.graph.get", reqId: "loud", includeReads: true });
    const loud = await client.waitFor(
      "brain.graph",
      (m) => (m as { reqId: string }).reqId === "loud",
    );

    // The template ships a run that read four notes, so there is something to see.
    expect(loud.graph.edges.filter((e) => e.kind === "read").length).toBeGreaterThan(0);

    client.socket.close();
  }, 20_000);

  it("carries who read and wrote what, from the run log", async () => {
    const { server } = await office();
    const client = await connect(server);

    client.send({ type: "brain.graph.get", reqId: "g" });
    const { graph } = await client.waitFor("brain.graph");

    expect(graph.nodes.some((n) => n.readBy.length > 0)).toBe(true);
    expect(graph.nodes.some((n) => n.wroteBy !== undefined)).toBe(true);

    client.socket.close();
  }, 20_000);
});
