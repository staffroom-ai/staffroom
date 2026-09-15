import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRedaction, configureRedaction } from "../redact.js";
import { deliverableTitle, type Run, type RunEvent } from "./events.js";
import { newApprovalId, newRunId, SqliteRunStore } from "./store.js";

afterEach(clearRedaction);

/** A real file, never :memory:, because WAL and second connections are under test. */
const storeFile = () => join(mkdtempSync(join(tmpdir(), "staffroom-runs-")), "runs.sqlite");
const open = (file = storeFile(), chunkFlushMs = 0) => new SqliteRunStore(file, { chunkFlushMs });

const runSeed = (over: Partial<Run> = {}) => ({
  id: newRunId(),
  kind: "task" as const,
  agentId: "copywriter",
  department: "marketing",
  model: { provider: "anthropic", model: "claude-sonnet-5" },
  prompt: "Write a two-line tagline for a bakery",
  parentRunId: null,
  routineId: null,
  sample: false,
  createdAt: Date.now(),
  ...over,
});

const doneEvent = (over: Partial<Extract<RunEvent, { type: "done" }>> = {}): RunEvent => ({
  type: "done",
  deliverable: {
    title: "Tagline",
    text: "# Tagline\n\nFresh daily.",
    noteId: "40-deliverables/marketing/tagline",
  },
  usage: { inputTokens: 120, outputTokens: 40 },
  costUsd: 0.0012,
  toolsUsed: ["brain_search"],
  turns: 2,
  ...over,
});

describe("create and get", () => {
  it("stores a run as queued with no usage yet", async () => {
    const store = open();
    const run = await store.create(runSeed());
    expect(run.status).toBe("queued");

    const loaded = await store.get(run.id);
    expect(loaded).toMatchObject({
      id: run.id,
      agentId: "copywriter",
      model: { provider: "anthropic", model: "claude-sonnet-5" },
      costUsd: null,
    });
    store.close();
  });

  it("returns null for a run that does not exist", async () => {
    const store = open();
    await expect(store.get("run_nope")).resolves.toBeNull();
    store.close();
  });

  it("round-trips a model id whose model half contains slashes", async () => {
    const store = open();
    const run = await store.create(
      runSeed({ model: { provider: "openrouter", model: "anthropic/claude-sonnet-5" } }),
    );
    expect((await store.get(run.id))?.model).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5",
    });
    store.close();
  });
});

describe("the runs row follows the events", () => {
  it("goes queued, running, waiting_approval, running, done", async () => {
    const store = open();
    const run = await store.create(runSeed());
    const status = async () => (await store.get(run.id))?.status;

    expect(await status()).toBe("queued");

    await store.append(run.id, {
      type: "started",
      agentId: "copywriter",
      kind: "task",
      model: { provider: "anthropic", model: "claude-sonnet-5" },
      modelSource: "agent",
      prompt: "x",
      parentRunId: null,
      routineId: null,
      systemPromptHash: "h",
      toolNames: [],
    });
    expect(await status()).toBe("running");

    const approvalId = newApprovalId();
    await store.append(run.id, {
      type: "approval_needed",
      approvalId,
      toolCallId: "c1",
      tool: { name: "gmail.send", source: { kind: "mcp", server: "gmail" }, scope: "write" },
      input: {},
      preview: {
        action: "Send an email",
        destination: "a@b.c",
        summary: "s",
        body: "b",
        irreversible: true,
      },
      requestedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });
    expect(await status()).toBe("waiting_approval");

    await store.append(run.id, {
      type: "approval_resolved",
      approvalId,
      decision: "approve",
      by: "owner",
    });
    expect(await status()).toBe("running");

    await store.append(run.id, doneEvent());
    const finished = await store.get(run.id);
    expect(finished).toMatchObject({
      status: "done",
      usage: { inputTokens: 120, outputTokens: 40 },
      costUsd: 0.0012,
    });
    expect(finished?.finishedAt).toBeGreaterThan(0);
    store.close();
  });

  it("marks a failed run failed and stamps when it ended", async () => {
    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, {
      type: "failed",
      error: { code: "MAX_TURNS", message: "m", hint: "h", detail: {} },
      partialText: "half",
      turns: 12,
    });
    const failed = await store.get(run.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.finishedAt).toBeGreaterThan(0);
    store.close();
  });
});

describe("redaction on the way in", () => {
  it("stores the redacted payload, so the secret never reaches the disk", async () => {
    const marker = "MARKER-abcdefghijklmnop";
    configureRedaction([marker]);

    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, {
      type: "tool_result",
      toolCallId: "c1",
      name: "lookup_order",
      output: `fetched with ${marker}`,
      isError: false,
      durationMs: 12,
      truncated: false,
      redactedCount: 0,
    });

    const events = [];
    for await (const e of store.events(run.id)) events.push(e);
    expect(JSON.stringify(events)).not.toContain(marker);
    expect(JSON.stringify(events)).toContain("••••");
    store.close();
  });
});

describe("chunk batching", () => {
  it("gives subscribers every chunk immediately, before they are on disk", async () => {
    const store = open(storeFile(), 50);
    const run = await store.create(runSeed());
    const seen: string[] = [];
    store.subscribe((e) => {
      if (e.event.type === "chunk") seen.push(e.event.text);
    });

    for (const text of ["North", "light", " Studio"]) {
      await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text });
    }
    // Delivered to the office already, not yet written.
    expect(seen).toEqual(["North", "light", " Studio"]);

    store.flush();
    const events = [];
    for await (const e of store.events(run.id)) events.push(e);
    expect(events).toHaveLength(3);
    store.close();
  });

  it("flushes buffered chunks before an event that changes the run row", async () => {
    const store = open(storeFile(), 1000);
    const run = await store.create(runSeed());
    await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "hi" });
    await store.append(run.id, doneEvent());

    const events = [];
    for await (const e of store.events(run.id)) events.push(e);
    // The chunk must be recorded before the done, or replay shows the answer
    // arriving before the text that produced it.
    expect(events.map((e) => e.event.type)).toEqual(["chunk", "done"]);
    expect(events[0]?.seq).toBeLessThan(events[1]?.seq as number);
    store.close();
  });

  it("writes chunks immediately when batching is off", async () => {
    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "a" });
    const events = [];
    for await (const e of store.events(run.id)) events.push(e);
    expect(events).toHaveLength(1);
    store.close();
  });
});

describe("since", () => {
  it("returns only events after the given sequence, for the server to tail", async () => {
    const store = open();
    const run = await store.create(runSeed());
    const first = await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "a" });
    await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "b" });

    const tail = [];
    for await (const e of store.since(first.seq)) tail.push(e);
    expect(tail).toHaveLength(1);
    expect(tail[0]?.event).toMatchObject({ text: "b" });
    store.close();
  });

  it("returns everything from zero", async () => {
    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "a" });
    const all = [];
    for await (const e of store.since(0)) all.push(e);
    expect(all).toHaveLength(1);
    store.close();
  });
});

describe("list", () => {
  it("filters by status, kind and agent, newest first", async () => {
    const store = open();
    const a = await store.create(runSeed({ agentId: "copywriter", createdAt: 1000 }));
    const b = await store.create(runSeed({ agentId: "researcher", kind: "chat", createdAt: 2000 }));
    await store.append(a.id, doneEvent());

    expect((await store.list({})).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await store.list({ agentId: "researcher" })).map((r) => r.id)).toEqual([b.id]);
    expect((await store.list({ kind: ["chat"] })).map((r) => r.id)).toEqual([b.id]);
    expect((await store.list({ status: ["done"] })).map((r) => r.id)).toEqual([a.id]);
    expect(await store.list({ limit: 1 })).toHaveLength(1);
    store.close();
  });
});

describe("lastDeliverable", () => {
  it("returns the newest deliverable for that agent", async () => {
    const store = open();
    const older = await store.create(runSeed({ createdAt: 1000 }));
    await store.append(
      older.id,
      doneEvent({ deliverable: { title: "Old", text: "old", noteId: "n/old" } }),
    );
    const newer = await store.create(runSeed({ createdAt: 2000 }));
    await store.append(
      newer.id,
      doneEvent({ deliverable: { title: "New", text: "new", noteId: "n/new" } }),
    );

    const found = await store.lastDeliverable("copywriter");
    expect(found?.deliverable.title).toBe("New");
    store.close();
  });

  it("ignores route runs, which produce no work of their own", async () => {
    const store = open();
    const route = await store.create(runSeed({ kind: "route", agentId: "marketing-lead" }));
    await store.append(
      route.id,
      doneEvent({ deliverable: { title: "R", text: "r", noteId: "n/r" } }),
    );
    await expect(store.lastDeliverable("marketing-lead")).resolves.toBeNull();
    store.close();
  });

  it("ignores a deliverable that never reached the brain", async () => {
    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, doneEvent({ deliverable: { title: "T", text: "t", noteId: null } }));
    await expect(store.lastDeliverable("copywriter")).resolves.toBeNull();
    store.close();
  });

  it("returns null for an agent who has done nothing", async () => {
    const store = open();
    await expect(store.lastDeliverable("nobody")).resolves.toBeNull();
    store.close();
  });
});

describe("pendingApprovals", () => {
  const ask = (approvalId: string): RunEvent => ({
    type: "approval_needed",
    approvalId,
    toolCallId: "c1",
    tool: { name: "gmail.send", source: { kind: "mcp", server: "gmail" }, scope: "write" },
    input: {},
    preview: { action: "Send", destination: "a@b.c", summary: "s", body: "b", irreversible: true },
    requestedAt: 1,
    expiresAt: 2,
  });

  it("lists what is still waiting, with the run it belongs to", async () => {
    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, ask("apr_1"));

    const pending = await store.pendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ approvalId: "apr_1", runId: run.id });
    store.close();
  });

  it("drops one once it is resolved, however it was resolved", async () => {
    const store = open();
    const run = await store.create(runSeed());
    await store.append(run.id, ask("apr_1"));
    await store.append(run.id, ask("apr_2"));
    await store.append(run.id, {
      type: "approval_resolved",
      approvalId: "apr_1",
      decision: "deny",
      by: "owner",
    });
    await store.append(run.id, {
      type: "approval_resolved",
      approvalId: "apr_2",
      decision: "expired",
      by: "system",
    });

    await expect(store.pendingApprovals()).resolves.toEqual([]);
    store.close();
  });
});

describe("concurrent readers", () => {
  it("a second connection replays while the first keeps writing", async () => {
    const file = storeFile();
    const writer = open(file);
    const run = await writer.create(runSeed());
    await writer.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "first" });

    const reader = new SqliteRunStore(file, { chunkFlushMs: 0 });
    const before = [];
    for await (const e of reader.events(run.id)) before.push(e);
    expect(before).toHaveLength(1);

    await writer.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "second" });
    const after = [];
    for await (const e of reader.events(run.id)) after.push(e);
    expect(after).toHaveLength(2);

    reader.close();
    writer.close();
  });
});

describe("subscribe", () => {
  it("stops delivering once unsubscribed", async () => {
    const store = open();
    const run = await store.create(runSeed());
    const seen: string[] = [];
    const off = store.subscribe((e) => seen.push(e.event.type));

    await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "a" });
    off();
    await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: "b" });
    expect(seen).toEqual(["chunk"]);
    store.close();
  });
});

describe("ids and titles", () => {
  it("prefixes ids so a stray one is identifiable", () => {
    expect(newRunId()).toMatch(/^run_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newApprovalId()).toMatch(/^apr_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("takes the title from a heading, else the first line, else truncates", () => {
    expect(deliverableTitle("# Bakery tagline\n\nFresh daily.")).toBe("Bakery tagline");
    expect(deliverableTitle("Fresh daily.\nmore")).toBe("Fresh daily.");
    expect(deliverableTitle("x".repeat(80))).toBe(`${"x".repeat(60)}...`);
  });
});

describe("throughput", () => {
  it("appends 10,000 events in under two seconds", async () => {
    const store = open(storeFile(), 100);
    const run = await store.create(runSeed());
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      await store.append(run.id, { type: "chunk", turn: 1, attempt: 1, text: `t${i}` });
    }
    store.flush();
    const elapsed = performance.now() - started;

    const events = [];
    for await (const e of store.events(run.id)) events.push(e);
    expect(events).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(2000);
    store.close();
  });
});
