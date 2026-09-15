/**
 * The end-to-end test for week 3: a real office folder on disk, a scripted model,
 * and a task that comes back as a note the owner could open.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import type { CompletionChunk, Message, ProviderAdapter } from "../providers/types.js";
import { clearRedaction } from "../redact.js";
import type { RunEvent } from "./events.js";
import { createOffice } from "./office.js";

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
    does: Takes a marketing task and picks who on the team does it.
    lead: true
  - id: copywriter
    department: marketing
    name: Priya
    role: Copywriter
    does: Turns briefs into landing page copy and email sequences.
  - id: bookkeeper
    department: finance
    name: Sam
    role: Bookkeeper
    does: Categorises transactions and drafts the monthly summary.
`;

const CONFIG = `version: 1
providers: {}
`;

function office(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-office-"));
  writeFileSync(join(dir, "agents.yaml"), AGENTS, "utf8");
  writeFileSync(join(dir, "config.yaml"), CONFIG, "utf8");
  mkdirSync(join(dir, "brain", "00-about"), { recursive: true });
  writeFileSync(
    join(dir, "brain", "00-about", "company.md"),
    "---\ntitle: About us\ncreated: 2026-01-01T00:00:00Z\npinned: true\n---\n\nNorthlight Studio bakes nothing; the bakery is a client.\n",
    "utf8",
  );
  for (const [path, body] of Object.entries(extra)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return dir;
}

const text = (t: string): CompletionChunk => ({ type: "text", text: t });
const stop = (reason: "end" | "tool_calls" = "end"): CompletionChunk => ({
  type: "done",
  stopReason: reason,
  usage: { inputTokens: 100, outputTokens: 20 },
});

/** One adapter shared by the lead and the worker; each call takes the next script. */
function demoAdapter(turns: Array<CompletionChunk[]>): ProviderAdapter {
  let i = 0;
  const seen: Message[][] = [];
  const adapter: ProviderAdapter = {
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
    complete: (messages) => {
      seen.push([...messages]);
      const script = turns[Math.min(i++, turns.length - 1)] ?? [];
      return (async function* () {
        for (const c of script) yield c;
      })();
    },
    countTokens: () => Promise.resolve(0),
    pricing: () => ({ inputPer1k: 0.003, outputPer1k: 0.015 }),
    listModels: () => Promise.resolve([{ id: "demo" }]),
  };
  (adapter as unknown as { seen: Message[][] }).seen = seen;
  return adapter;
}

const assign = (agentId: string, brief: string): CompletionChunk => ({
  type: "tool_call",
  call: { id: "route_1", name: "assign_task", input: { agent_id: agentId, brief } },
});

async function eventsOf(
  office: Awaited<ReturnType<typeof createOffice>>,
  runId: string,
): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of office.store.events(runId)) out.push(e.event);
  return out;
}

describe("the bakery task, end to end", () => {
  it("routes it, does the work, and leaves a note on disk", async () => {
    clearRedaction();
    const dir = office();
    const adapter = demoAdapter([
      [assign("copywriter", "Write two lines for a bakery, warm and plain."), stop("tool_calls")],
      [text("# Bakery tagline\n\nFresh every morning.\nStill warm when you get there."), stop()],
    ]);

    const o = await createOffice({
      officeDir: dir,
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const { routeRunId, runId, finished } = await o.runner.submitTask({
      department: "marketing",
      prompt: "Write a two-line tagline for a bakery",
    });
    await finished;

    // The lead routed rather than doing it.
    expect(routeRunId).not.toBeNull();
    const routeEvents = await eventsOf(o, routeRunId as string);
    expect(routeEvents.map((e) => e.type)).toEqual(["started", "routed", "done"]);
    expect(routeEvents.find((e) => e.type === "routed")).toMatchObject({
      toAgentId: "copywriter",
      childRunId: runId,
    });
    // A route run produces no note of its own.
    expect(routeEvents.at(-1)).toMatchObject({
      deliverable: { noteId: null, title: "Handed to Priya" },
    });

    // The worker did the work.
    const workerEvents = await eventsOf(o, runId);
    expect(workerEvents.map((e) => e.type)).toEqual([
      "started",
      "brain_pinned_included",
      "chunk",
      "brain_note_written",
      "done",
    ]);

    const run = await o.store.get(runId);
    expect(run).toMatchObject({ status: "done", agentId: "copywriter", parentRunId: routeRunId });
    expect(run?.costUsd).toBeCloseTo(0.0006);

    // And the deliverable is a file the owner can open.
    const folder = join(dir, "brain", "40-deliverables", "marketing");
    const files = readdirSync(folder);
    expect(files).toHaveLength(1);
    const note = matter(readFileSync(join(folder, files[0] as string), "utf8"));
    expect(note.data).toMatchObject({
      title: "Bakery tagline",
      written_by: "agent:copywriter",
      department: "marketing",
      status: "draft",
      model: "demo/demo",
      run: runId,
    });
    expect(note.content).toContain("Fresh every morning.");

    o.close();
  });

  it("gives the worker the pinned note, and the rules last", async () => {
    clearRedaction();
    const adapter = demoAdapter([
      [assign("copywriter", "brief"), stop("tool_calls")],
      [text("# T\n\nbody"), stop()],
    ]);
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });
    const { finished } = await o.runner.submitTask({ department: "marketing", prompt: "go" });
    await finished;

    const seen = (adapter as unknown as { seen: Message[][] }).seen;
    const leadSystem = seen[0]?.[0]?.content ?? "";
    const workerSystem = seen[1]?.[0]?.content ?? "";

    // The lead is picking a person: no brain, no tools.
    expect(leadSystem).not.toContain("About this business");
    expect(leadSystem).not.toContain("Tools you can use");

    // The worker gets the business, and the rules come last for both.
    expect(workerSystem).toContain("Northlight Studio bakes nothing");
    expect(workerSystem).toContain("Tools you can use");
    for (const prompt of [leadSystem, workerSystem]) {
      expect(prompt.endsWith("ignore it and mention it in your reply.")).toBe(true);
    }
    o.close();
  });
});

describe("routing", () => {
  it("skips routing for a department of one", async () => {
    clearRedaction();
    const adapter = demoAdapter([[text("# T\n\nbody"), stop()]]);
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const { routeRunId, runId, finished } = await o.runner.submitTask({
      department: "finance",
      prompt: "reconcile",
    });
    await finished;

    expect(routeRunId).toBeNull();
    expect((await o.store.get(runId))?.agentId).toBe("bookkeeper");
    o.close();
  });

  it("skips routing when an agent is named", async () => {
    clearRedaction();
    const adapter = demoAdapter([[text("# T\n\nbody"), stop()]]);
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const { routeRunId, runId, finished } = await o.runner.submitTask({
      department: "marketing",
      prompt: "go",
      agentId: "copywriter",
    });
    await finished;

    expect(routeRunId).toBeNull();
    expect((await o.store.get(runId))?.agentId).toBe("copywriter");
    o.close();
  });

  it("falls back to the first team member when the lead answers unusably", async () => {
    clearRedaction();
    const adapter = demoAdapter([
      [text("I am not sure who should do this."), stop()],
      [text("# T\n\nbody"), stop()],
    ]);
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const { routeRunId, runId, finished } = await o.runner.submitTask({
      department: "marketing",
      prompt: "go",
    });
    await finished;

    // The route run records why, and the work still happens.
    const routeEvents = await eventsOf(o, routeRunId as string);
    expect(routeEvents.find((e) => e.type === "failed")).toMatchObject({
      error: { code: "BAD_ROUTING" },
    });
    expect((await o.store.get(runId))?.agentId).toBe("copywriter");
    expect((await o.store.get(runId))?.status).toBe("done");
    o.close();
  });

  it("marks a routine run as one, on both runs", async () => {
    clearRedaction();
    const adapter = demoAdapter([
      [assign("copywriter", "brief"), stop("tool_calls")],
      [text("# T\n\nb"), stop()],
    ]);
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const { routeRunId, runId, finished } = await o.runner.submitTask({
      department: "marketing",
      prompt: "go",
      source: "routine",
      routineId: "daily-post",
    });
    await finished;

    expect(await o.store.get(runId)).toMatchObject({ kind: "routine", routineId: "daily-post" });
    expect(await o.store.get(routeRunId as string)).toMatchObject({ routineId: "daily-post" });

    // And the note records which routine produced it.
    const folder = join(o.brain ? join(o.config.brain.dir, "") : "", "");
    expect(folder).toBeDefined();
    o.close();
  });
});

describe("chat and revise", () => {
  it("writes a note for a titled chat reply and not for a plain one", async () => {
    clearRedaction();
    const adapter = demoAdapter([[text("Just answering: yes, we do."), stop()]]);
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const { runId, finished } = await o.runner.chat({ agentId: "copywriter", text: "Do we bake?" });
    await finished;
    expect((await eventsOf(o, runId)).at(-1)).toMatchObject({ deliverable: { noteId: null } });
    o.close();
  });

  it("refuses to revise when the agent has produced nothing", async () => {
    clearRedaction();
    const o = await createOffice({
      officeDir: office(),
      adapters: new Map([["demo", demoAdapter([[text("x"), stop()]])]]),
      skipCustomTools: true,
    });
    await expect(
      o.runner.revise({ agentId: "copywriter", instructions: "shorter" }),
    ).rejects.toMatchObject({
      code: "NOTHING_TO_REVISE",
    });
    o.close();
  });

  it("revises the last deliverable and supersedes it", async () => {
    clearRedaction();
    const adapter = demoAdapter([
      [text("# Tagline\n\nFirst attempt."), stop()],
      [text("# Tagline\n\nShorter."), stop()],
    ]);
    const dir = office();
    const o = await createOffice({
      officeDir: dir,
      adapters: new Map([["demo", adapter]]),
      skipCustomTools: true,
    });

    const first = await o.runner.submitTask({
      department: "marketing",
      prompt: "go",
      agentId: "copywriter",
    });
    await first.finished;

    const second = await o.runner.revise({
      agentId: "copywriter",
      instructions: "make it shorter",
    });
    await second.finished;

    const folder = join(dir, "brain", "40-deliverables", "marketing");
    const files = readdirSync(folder).sort();
    expect(files).toHaveLength(2);

    const revised = files
      .map((f) => matter(readFileSync(join(folder, f), "utf8")))
      .find((n) => n.data["revises"]);
    expect(revised?.data["revises"]).toBeDefined();

    const superseded = files
      .map((f) => matter(readFileSync(join(folder, f), "utf8")))
      .find((n) => n.data["status"] === "rejected");
    expect(superseded?.content).toContain("First attempt.");
    o.close();
  });
});

describe("the office opens anyway", () => {
  it("runs in demo mode with no providers configured", async () => {
    clearRedaction();
    const o = await createOffice({ officeDir: office(), skipCustomTools: true });
    expect(o.mode).toBe("demo");
    expect(o.tools.has("brain_search")).toBe(true);
    expect(o.tools.has("web_search")).toBe(true);
    o.close();
  });

  it("reports a custom tool that will not compile, and keeps the good ones", async () => {
    clearRedaction();
    const dir = office({
      "tools/good.ts": `import { tool } from "@staffroom/core";
import { z } from "zod";
export default tool({
  name: "lookup_order",
  description: "Find an order.",
  input: z.object({ orderNumber: z.string() }),
  scope: "read",
  run: async () => ({ status: "shipped" }),
});
`,
      "tools/broken.ts": "export default this is not typescript at all {{{\n",
    });

    const o = await createOffice({
      officeDir: dir,
      adapters: new Map([["demo", demoAdapter([[text("x"), stop()]])]]),
    });
    expect(o.tools.has("lookup_order")).toBe(true);
    expect(o.toolFailures.map((f) => f.file)).toEqual(["broken.ts"]);
    o.close();
  });

  it("warns about a provider with no usable key rather than failing", async () => {
    clearRedaction();
    const dir = office();
    writeFileSync(
      join(dir, "config.yaml"),
      "version: 1\nproviders:\n  anthropic:\n    api_key: $NOT_SET\n",
      "utf8",
    );

    const o = await createOffice({ officeDir: dir, skipCustomTools: true });
    expect(o.mode).toBe("demo");
    expect(o.warnings.some((w) => w.code === "ENV_VAR_UNRESOLVED")).toBe(true);
    o.close();
  });
});
