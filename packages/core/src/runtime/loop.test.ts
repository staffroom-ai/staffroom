import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConfigSchema } from "../config/config.js";
import type { CompletionChunk, Message, ProviderAdapter } from "../providers/types.js";
import type { BrainReader } from "../shared/types.js";
import { type ApprovalRequest, ToolRegistry } from "../tools/registry.js";
import { type Tool, tool } from "../tools/tool.js";
import { ProviderError } from "./errors.js";
import type { RunEvent } from "./events.js";
import { costOf, type LoopContext, messagesFromEvents, runAgentLoop } from "./loop.js";
import { newRunId, SqliteRunStore } from "./store.js";

const store = () =>
  new SqliteRunStore(join(mkdtempSync(join(tmpdir(), "staffroom-loop-")), "runs.sqlite"), {
    chunkFlushMs: 0,
  });

const brain: BrainReader = {
  search: () => Promise.resolve([]),
  read: () => Promise.resolve(null),
  list: () => Promise.resolve([]),
};

/** A scripted adapter: each element is one turn's chunks, or an error to throw. */
function scripted(turns: Array<CompletionChunk[] | Error>): ProviderAdapter {
  let turn = 0;
  const sent: Message[][] = [];
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
      sent.push([...messages]);
      const script = turns[Math.min(turn++, turns.length - 1)];
      if (script instanceof Error) {
        // biome-ignore lint/correctness/useYield: a generator that only throws has nothing to yield.
        return (async function* () {
          throw script;
        })();
      }
      return (async function* () {
        for (const chunk of script ?? []) yield chunk;
      })();
    },
    countTokens: () => Promise.resolve(0),
    pricing: () => null,
    listModels: () => Promise.resolve([]),
  };
  (adapter as unknown as { sent: Message[][] }).sent = sent;
  return adapter;
}

const text = (t: string): CompletionChunk => ({ type: "text", text: t });
const done = (stopReason: "end" | "tool_calls" | "max_tokens" = "end"): CompletionChunk => ({
  type: "done",
  stopReason,
  usage: { inputTokens: 100, outputTokens: 20 },
});
const callChunk = (
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): CompletionChunk => ({
  type: "tool_call",
  call: { id, name, input },
});

const readTool = (over: Partial<Tool> = {}) =>
  ({
    ...tool({
      name: "brain_search",
      description: "Search the notes.",
      input: z.object({ query: z.string() }),
      scope: "read",
      run: async () => ({ notes: [{ id: "10-customers/acme" }], noteIds: ["10-customers/acme"] }),
    }),
    source: { kind: "builtin" },
    ...over,
  }) as Tool;

const writeTool = (over: Partial<Tool> = {}) =>
  ({
    ...tool({
      name: "send_email",
      description: "Send an email.",
      input: z.object({ to: z.string() }),
      scope: "write",
      run: async () => ({ sent: true }),
    }),
    source: { kind: "custom", file: "send-email.ts" },
    ...over,
  }) as Tool;

interface Harness {
  ctx: LoopContext;
  events: () => Promise<RunEvent[]>;
  types: () => Promise<string[]>;
  asked: ApprovalRequest[];
  registry: ToolRegistry;
  written: Array<{ title: string; body: string }>;
}

async function harness(
  adapter: ProviderAdapter,
  tools: Tool[] = [],
  over: Partial<LoopContext> = {},
): Promise<Harness> {
  const config = ConfigSchema.parse({ version: 1 });
  const asked: ApprovalRequest[] = [];
  const registry = new ToolRegistry({ config, onApprovalNeeded: (r) => asked.push(r) });
  for (const t of tools) registry.register(t);

  const s = store();
  const runId = newRunId();
  await s.create({
    id: runId,
    kind: "task",
    agentId: "copywriter",
    department: "marketing",
    model: { provider: "demo", model: "demo" },
    prompt: "Write a tagline",
    parentRunId: null,
    routineId: null,
    sample: false,
    createdAt: Date.now(),
  });

  const written: Array<{ title: string; body: string }> = [];
  const ctx: LoopContext = {
    runId,
    kind: "task",
    agentId: "copywriter",
    department: "marketing",
    adapter,
    model: "demo",
    modelSource: "office_default",
    pricing: null,
    prompt: "Write a tagline",
    systemPrompt: "You are Priya.",
    systemPromptHash: "abc",
    pinnedIncluded: [],
    pinnedTruncated: [],
    tools: registry,
    allowedTools: registry.list(),
    store: s,
    brain,
    signal: new AbortController().signal,
    config: {
      maxTurns: config.runner.max_turns,
      maxParallelTools: config.runner.max_parallel_tools,
      maxOutputTokens: config.runner.max_output_tokens,
      toolOutputMaxChars: config.runner.tool_output_max_chars,
      retries: { attempts: 3, baseMs: 1, maxMs: 2 },
    },
    parentRunId: null,
    routineId: null,
    writeDeliverable: async ({ title, body }) => {
      written.push({ title, body });
      return { noteId: "40-deliverables/marketing/2026-09-16-tagline" };
    },
    ...over,
  };

  const collect = async (): Promise<RunEvent[]> => {
    const out: RunEvent[] = [];
    for await (const e of s.events(runId)) out.push(e.event);
    return out;
  };

  return {
    ctx,
    events: collect,
    types: async () => (await collect()).map((e) => e.type),
    asked,
    registry,
    written,
  };
}

describe("a plain deliverable", () => {
  it("produces exactly the documented event sequence", async () => {
    const h = await harness(scripted([[text("# Tagline\n\nFresh daily."), done()]]));
    await runAgentLoop(h.ctx);

    expect(await h.types()).toEqual(["started", "chunk", "brain_note_written", "done"]);
    const events = await h.events();
    const finished = events.at(-1);
    expect(finished).toMatchObject({
      type: "done",
      deliverable: { title: "Tagline", noteId: "40-deliverables/marketing/2026-09-16-tagline" },
      turns: 1,
    });
  });

  it("records what the agent was given at the start", async () => {
    const h = await harness(scripted([[text("# T\n\nb"), done()]]), [readTool()]);
    await runAgentLoop(h.ctx);
    expect((await h.events())[0]).toMatchObject({
      type: "started",
      agentId: "copywriter",
      kind: "task",
      systemPromptHash: "abc",
      toolNames: ["brain_search"],
    });
  });

  it("reports which pinned notes made it in and which did not", async () => {
    const h = await harness(scripted([[text("# T\n\nb"), done()]]), [], {
      pinnedIncluded: ["00-about/a"],
      pinnedTruncated: ["00-about/b"],
    });
    await runAgentLoop(h.ctx);
    const types = await h.types();
    expect(types).toContain("brain_pinned_included");
    expect(types).toContain("brain_pinned_truncated");
  });
});

describe("tools", () => {
  it("records a read call and feeds the result back as untrusted", async () => {
    const h = await harness(
      scripted([
        [callChunk("c1", "brain_search", { query: "pricing" }), done("tool_calls")],
        [text("# T\n\nb"), done()],
      ]),
      [readTool()],
    );
    await runAgentLoop(h.ctx);

    expect(await h.types()).toEqual([
      "started",
      "tool_call",
      "tool_result",
      "chunk",
      "brain_note_written",
      "done",
    ]);
    const result = (await h.events()).find((e) => e.type === "tool_result");
    expect(result).toMatchObject({
      name: "brain_search",
      isError: false,
      noteIds: ["10-customers/acme"],
    });

    // The model sees the result wrapped, which is what the safety rule refers to.
    const sent = (h.ctx.adapter as unknown as { sent: Message[][] }).sent;
    const toolMessage = sent[1]?.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain('<tool_result name="brain_search" trust="untrusted">');
  });

  it("tells the model when it asked for a tool it may not use, and carries on", async () => {
    const h = await harness(
      scripted([
        [callChunk("c1", "stripe.refund"), done("tool_calls")],
        [text("# T\n\nb"), done()],
      ]),
      [readTool()],
    );
    await runAgentLoop(h.ctx);

    const result = (await h.events()).find((e) => e.type === "tool_result");
    expect(result).toMatchObject({
      isError: true,
      output: 'Tool "stripe.refund" is not available to you. Say so in your reply and stop.',
    });
    expect((await h.types()).at(-1)).toBe("done");
  });

  it("blocks on a write until the owner approves, then finishes", async () => {
    const h = await harness(
      scripted([
        [callChunk("c1", "send_email", { to: "a@b.c" }), done("tool_calls")],
        [text("# T\n\nb"), done()],
      ]),
      [writeTool()],
    );
    const running = runAgentLoop(h.ctx);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    h.registry.resolve(h.asked[0]?.approvalId as string, "approve", "owner");
    await running;

    expect((await h.events()).find((e) => e.type === "tool_result")).toMatchObject({
      isError: false,
    });
  });

  it("returns the owner's refusal to the model rather than failing the run", async () => {
    const h = await harness(
      scripted([
        [callChunk("c1", "send_email", { to: "a@b.c" }), done("tool_calls")],
        [text("# T\n\nI could not send it."), done()],
      ]),
      [writeTool()],
    );
    const running = runAgentLoop(h.ctx);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    h.registry.resolve(h.asked[0]?.approvalId as string, "deny", "owner");
    await running;

    expect((await h.events()).find((e) => e.type === "tool_result")).toMatchObject({
      isError: true,
      output: "The owner declined this action.",
    });
    expect((await h.types()).at(-1)).toBe("done");
  });

  it("returns results in the order the calls were issued, not the order they finished", async () => {
    const slow = {
      ...readTool({ name: "slow_one" }),
      input: z.object({}),
      run: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: 1 };
      },
    } as Tool;
    const fast = {
      ...readTool({ name: "fast_one" }),
      input: z.object({}),
      run: async () => ({ ok: 2 }),
    } as Tool;
    const h = await harness(
      scripted([
        [callChunk("c1", "slow_one"), callChunk("c2", "fast_one"), done("tool_calls")],
        [text("# T\n\nb"), done()],
      ]),
      [slow, fast],
    );
    await runAgentLoop(h.ctx);

    const sent = (h.ctx.adapter as unknown as { sent: Message[][] }).sent;
    const toolMessages = sent[1]?.filter((m) => m.role === "tool") ?? [];
    expect(toolMessages.map((m) => (m as { name: string }).name)).toEqual(["slow_one", "fast_one"]);
  });

  it("truncates a very long result and says so", async () => {
    const chatty = {
      ...readTool({ name: "chatty" }),
      input: z.object({}),
      run: async () => ({ text: "x".repeat(50_000) }),
    } as Tool;
    const h = await harness(
      scripted([
        [callChunk("c1", "chatty"), done("tool_calls")],
        [text("# T\n\nb"), done()],
      ]),
      [chatty],
    );
    await runAgentLoop(h.ctx);
    const result = (await h.events()).find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ truncated: true });
    if (result?.type === "tool_result") expect(result.output).toContain("[truncated]");
  });

  it("gives up after three turns of nothing but errors", async () => {
    const broken = {
      ...readTool({ name: "broken" }),
      input: z.object({}),
      run: () => Promise.reject(new Error("nope")),
    } as Tool;
    const h = await harness(scripted([[callChunk("c1", "broken"), done("tool_calls")]]), [broken]);
    await runAgentLoop(h.ctx);

    const failed = (await h.events()).at(-1);
    expect(failed).toMatchObject({ type: "failed", error: { code: "TOOL_FAILED" } });
  });
});

describe("retries", () => {
  it("retries a rate limit and numbers the attempts", async () => {
    const h = await harness(
      scripted([
        new ProviderError("RATE_LIMITED", {}, { retryable: true, retryAfterMs: 1 }),
        [text("# T\n\nb"), done()],
      ]),
    );
    await runAgentLoop(h.ctx);

    const events = await h.events();
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.every((c) => c.type === "chunk" && c.attempt === 2)).toBe(true);
  });

  it("keeps partial text from a failed attempt, with its attempt number", async () => {
    const h = await harness(scripted([[text("half a thought")], [text("# T\n\nb"), done()]]));
    // The first turn never yields done, so the stream ends without one; the loop
    // treats that as a finished turn with no calls.
    await runAgentLoop(h.ctx);
    expect((await h.types()).at(-1)).toBe("done");
  });

  it("does not retry an error that is not retryable", async () => {
    const h = await harness(
      scripted([new ProviderError("AUTH_FAILED", { provider: "Demo" }, { status: 401 })]),
    );
    await runAgentLoop(h.ctx);
    expect((await h.events()).at(-1)).toMatchObject({
      type: "failed",
      error: { code: "AUTH_FAILED" },
    });
  });
});

describe("refusals and limits", () => {
  it("fails before the first request when the model cannot use the tools it was given", async () => {
    const adapter = scripted([[text("x"), done()]]);
    adapter.capabilities = () => ({
      supportsTools: false,
      supportsStreaming: true,
      supportsParallelToolCalls: false,
      supportsForcedTool: false,
      maxContextTokens: null,
    });
    const h = await harness(adapter, [readTool()]);
    await runAgentLoop(h.ctx);

    expect(await h.types()).toEqual(["started", "failed"]);
    expect((await h.events()).at(-1)).toMatchObject({ error: { code: "TOOLS_UNSUPPORTED" } });
  });

  it("reports a reply cut off by the token limit", async () => {
    const h = await harness(scripted([[text("half a "), done("max_tokens")]]));
    await runAgentLoop(h.ctx);
    expect((await h.events()).at(-1)).toMatchObject({
      type: "failed",
      error: { code: "OUTPUT_TRUNCATED" },
      partialText: "half a ",
    });
  });

  it("stops at max turns", async () => {
    const h = await harness(
      scripted([[callChunk("c1", "brain_search", { query: "a" }), done("tool_calls")]]),
      [readTool()],
      {
        config: {
          maxTurns: 2,
          maxParallelTools: 4,
          maxOutputTokens: 4096,
          toolOutputMaxChars: 20_000,
          retries: { attempts: 0, baseMs: 1, maxMs: 1 },
        },
      },
    );
    await runAgentLoop(h.ctx);
    expect((await h.events()).at(-1)).toMatchObject({
      type: "failed",
      error: { code: "MAX_TURNS" },
    });
  });

  it("writes nothing to the brain when the run is cancelled", async () => {
    const controller = new AbortController();
    const blocking = {
      ...readTool({ name: "blocking" }),
      input: z.object({}),
      run: () => new Promise(() => undefined),
    } as Tool;
    const h = await harness(
      scripted([[callChunk("c1", "blocking"), done("tool_calls")]]),
      [blocking],
      { signal: controller.signal },
    );

    const running = runAgentLoop(h.ctx);
    await vi.waitFor(async () => expect(await h.types()).toContain("tool_call"));
    controller.abort();
    await running;

    const events = await h.events();
    expect(events.at(-1)).toMatchObject({ type: "failed", error: { code: "CANCELLED" } });
    expect(h.written).toHaveLength(0);
  });
});

describe("chat deliverables", () => {
  it("writes a note only when the reply starts with a title line", async () => {
    const titled = await harness(scripted([[text("# A title\n\nbody"), done()]]), [], {
      kind: "chat",
      writeOnlyTitledDeliverable: true,
    });
    await runAgentLoop(titled.ctx);
    expect(titled.written).toHaveLength(1);

    const plain = await harness(scripted([[text("Just answering your question."), done()]]), [], {
      kind: "chat",
      writeOnlyTitledDeliverable: true,
    });
    await runAgentLoop(plain.ctx);
    expect(plain.written).toHaveLength(0);
    expect((await plain.events()).at(-1)).toMatchObject({ deliverable: { noteId: null } });
  });
});

describe("costOf", () => {
  it("is null when the model has no price", () => {
    expect(costOf({ inputTokens: 1000, outputTokens: 1000 }, null)).toBeNull();
  });

  it("prices input and output separately", () => {
    expect(
      costOf({ inputTokens: 1000, outputTokens: 1000 }, { inputPer1k: 0.003, outputPer1k: 0.015 }),
    ).toBeCloseTo(0.018);
  });

  it("prices cached input at its own rate", () => {
    const cost = costOf(
      { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 900 },
      { inputPer1k: 0.003, outputPer1k: 0.015, cachedInputPer1k: 0.0003 },
    );
    expect(cost).toBeCloseTo(0.0003 + 0.00027);
  });
});

describe("messagesFromEvents", () => {
  it("rebuilds what the loop sent", async () => {
    const h = await harness(
      scripted([
        [callChunk("c1", "brain_search", { query: "pricing" }), done("tool_calls")],
        [text("# T\n\nb"), done()],
      ]),
      [readTool()],
    );
    await runAgentLoop(h.ctx);

    const rebuilt = messagesFromEvents(await h.events(), "You are Priya.");
    const sent = (h.ctx.adapter as unknown as { sent: Message[][] }).sent;

    // The rebuild is the whole conversation, so it is what the last call was given
    // plus the reply that call produced.
    expect(rebuilt.slice(0, -1)).toEqual(sent[1]);
    expect(rebuilt.at(-1)).toEqual({ role: "assistant", content: "# T\n\nb" });
  });

  it("keeps only the highest attempt of a retried turn", () => {
    const events: RunEvent[] = [
      {
        type: "started",
        agentId: "a",
        kind: "task",
        model: { provider: "p", model: "m" },
        modelSource: "agent",
        prompt: "go",
        parentRunId: null,
        routineId: null,
        systemPromptHash: "h",
        toolNames: [],
      },
      { type: "chunk", turn: 1, attempt: 1, text: "discarded" },
      { type: "chunk", turn: 1, attempt: 2, text: "kept" },
    ];
    const rebuilt = messagesFromEvents(events, "sys");
    expect(rebuilt.at(-1)).toEqual({ role: "assistant", content: "kept" });
  });
});

describe("an instruction hidden in a note", () => {
  it("does not act on it, and says so instead", async () => {
    // The oldest attack on an agent that reads things: leave it an order in the
    // material it is supposed to be summarising. The note is the owner's own
    // file, so it is trusted as content — but content is not instruction, and
    // nothing in it may cause a write.
    const send = writeTool({ name: "send_email" });

    const adapter = scripted([
      [
        text("The notes contain an instruction to email the customer list. I have not done that."),
        done(),
      ],
    ]);

    const h = await harness(adapter, [send], {
      pinnedIncluded: ["10-notes/voice"],
    });

    await runAgentLoop(h.ctx);

    // No write was attempted at all, so nobody was ever asked to approve one.
    expect(h.asked).toHaveLength(0);
    const types = await h.types();
    expect(types).not.toContain("approval_needed");
    expect(types).not.toContain("tool_call");

    // And the deliverable names the instruction rather than quietly ignoring it:
    // an owner needs to know their notes contain something that tried this.
    expect(h.written.map((w) => w.body).join(" ")).toMatch(/instruction/i);
  });

  it("wraps a tool result as untrusted, because a result is data", async () => {
    const adapter = scripted([
      [callChunk("c1", "brain_search", { query: "voice" }), done("tool_calls")],
      [text("Done."), done()],
    ]);

    const h = await harness(adapter, [readTool()]);
    await runAgentLoop(h.ctx);

    const events = await h.events();
    expect(events.filter((e) => e.type === "tool_result").length).toBeGreaterThan(0);

    // The wrapper is what stops a search result reading as an order. Checked on
    // the message content itself rather than a JSON dump of it, which escapes the
    // quotes and would pass on a string that never reached the model.
    const messages = messagesFromEvents(events, "Write a tagline");
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages.length).toBeGreaterThan(0);
    for (const message of toolMessages) {
      expect(String(message.content)).toContain('trust="untrusted"');
      expect(String(message.content)).toContain("</tool_result>");
    }
  });
});
