/**
 * Exercises complete() by standing in for the SDK's event stream. This covers the
 * two things that actually break when the wire format shifts: how our Messages map
 * onto Anthropic's shape, and how its events map back onto CompletionChunks.
 *
 * The conformance suite in conformance.test.ts covers the same rules against
 * recorded fixtures once STAFFROOM_RECORD=1 has produced them.
 */
import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import type { CompletionChunk, Message, ToolSpec } from "./types.js";

interface Captured {
  model: string;
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string }>;
  tool_choice?: { type: string; name: string };
}

/** Replaces client.messages.stream with a scripted event sequence, capturing the request. */
function stub(adapter: AnthropicAdapter, events: unknown[]): { captured: () => Captured } {
  let captured: Captured | undefined;
  const client = (adapter as unknown as { client: { messages: { stream: unknown } } }).client;
  client.messages.stream = (body: Captured) => {
    captured = body;
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
    };
  };
  return { captured: () => captured as Captured };
}

const make = () => new AnthropicAdapter({ apiKey: "sk-ant-test-not-a-real-key" });
const opts = () => ({
  model: "claude-sonnet-5",
  maxTokens: 512,
  signal: new AbortController().signal,
});

const START = {
  type: "message_start",
  message: { usage: { input_tokens: 42, output_tokens: 0, cache_read_input_tokens: 12 } },
};
const END = {
  type: "message_delta",
  delta: { stop_reason: "end_turn" },
  usage: { output_tokens: 7 },
};

async function run(
  adapter: AnthropicAdapter,
  messages: Message[],
  tools: ToolSpec[] = [],
): Promise<CompletionChunk[]> {
  const out: CompletionChunk[] = [];
  for await (const c of adapter.complete(messages, tools, opts())) out.push(c);
  return out;
}

describe("streaming", () => {
  it("turns text deltas into text chunks and reports usage on done", async () => {
    const adapter = make();
    stub(adapter, [
      START,
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "North" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "light" } },
      END,
    ]);

    const chunks = await run(adapter, [{ role: "user", content: "Name the company." }]);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("Northlight");

    const done = chunks.at(-1);
    expect(done).toEqual({
      type: "done",
      stopReason: "end",
      usage: { inputTokens: 42, outputTokens: 7, cachedInputTokens: 12 },
    });
  });

  it("assembles a tool call from streamed json deltas", async () => {
    const adapter = make();
    stub(adapter, [
      START,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "brain_search" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"query":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"pricing"}' },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 11 } },
    ]);

    const chunks = await run(adapter, [{ role: "user", content: "pricing?" }]);
    expect(chunks[0]).toEqual({
      type: "tool_call",
      call: { id: "toolu_1", name: "brain_search", input: { query: "pricing" } },
    });
    expect(chunks.at(-1)).toMatchObject({ type: "done", stopReason: "tool_calls" });
  });

  it("hands unparseable tool arguments to the loop as _raw", async () => {
    const adapter = make();
    stub(adapter, [
      START,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "brain_search" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{not json" },
      },
      { type: "content_block_stop", index: 0 },
      END,
    ]);

    const chunks = await run(adapter, [{ role: "user", content: "x" }]);
    expect(chunks[0]).toMatchObject({ type: "tool_call", call: { input: { _raw: "{not json" } } });
  });

  it("treats an empty argument buffer as no arguments", async () => {
    const adapter = make();
    stub(adapter, [
      START,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "t", name: "now" },
      },
      { type: "content_block_stop", index: 0 },
      END,
    ]);
    expect(await run(adapter, [{ role: "user", content: "x" }])).toContainEqual({
      type: "tool_call",
      call: { id: "t", name: "now", input: {} },
    });
  });

  it("keeps the last stop reason when a delta carries none", async () => {
    const adapter = make();
    stub(adapter, [START, { type: "message_delta", delta: {}, usage: { output_tokens: 3 } }]);
    expect(await run(adapter, [{ role: "user", content: "x" }])).toContainEqual({
      type: "done",
      stopReason: "end",
      usage: { inputTokens: 42, outputTokens: 3, cachedInputTokens: 12 },
    });
  });

  it("maps max_tokens to the max_tokens stop reason", async () => {
    const adapter = make();
    stub(adapter, [
      START,
      {
        type: "message_delta",
        delta: { stop_reason: "max_tokens" },
        usage: { output_tokens: 512 },
      },
    ]);
    expect(await run(adapter, [{ role: "user", content: "x" }])).toContainEqual({
      type: "done",
      stopReason: "max_tokens",
      usage: { inputTokens: 42, outputTokens: 512, cachedInputTokens: 12 },
    });
  });

  it("still emits done when nothing streamed at all", async () => {
    const adapter = make();
    stub(adapter, []);
    expect(await run(adapter, [{ role: "user", content: "" }])).toEqual([
      { type: "done", stopReason: "end", usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });
});

describe("message conversion", () => {
  it("lifts the system message out and joins several", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    await run(adapter, [
      { role: "system", content: "You are Priya." },
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
    ]);

    expect(captured().system).toBe("You are Priya.\n\nBe brief.");
    expect(captured().messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("turns an assistant turn with tool calls into text plus tool_use blocks", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    await run(adapter, [
      { role: "user", content: "pricing?" },
      {
        role: "assistant",
        content: "Looking.",
        toolCalls: [{ id: "toolu_1", name: "brain_search", input: { query: "pricing" } }],
      },
    ]);

    expect(captured().messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "toolu_1", name: "brain_search", input: { query: "pricing" } },
      ],
    });
  });

  it("omits the text block when the assistant said nothing", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    await run(adapter, [
      { role: "user", content: "x" },
      { role: "assistant", content: "", toolCalls: [{ id: "t", name: "now", input: {} }] },
    ]);
    expect(captured().messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "t", name: "now", input: {} }],
    });
  });

  it("merges consecutive tool results into one user message", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    await run(adapter, [
      { role: "user", content: "both?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "t1", name: "brain_search", input: { query: "pricing" } },
          { id: "t2", name: "brain_search", input: { query: "voice" } },
        ],
      },
      { role: "tool", toolCallId: "t1", name: "brain_search", content: "1200 AUD" },
      { role: "tool", toolCallId: "t2", name: "brain_search", content: "warm, plain" },
    ]);

    const merged = captured().messages[2] as { role: string; content: unknown[] };
    expect(merged.role).toBe("user");
    expect(merged.content).toHaveLength(2);
    expect(captured().messages).toHaveLength(3);
  });

  it("flags a failed tool result with is_error", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    await run(adapter, [
      { role: "user", content: "x" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "send", input: {} }] },
      { role: "tool", toolCallId: "t1", name: "send", content: "timed out", isError: true },
    ]);
    expect((captured().messages[2] as { content: unknown[] }).content[0]).toMatchObject({
      is_error: true,
    });
  });

  it("sends tools and a forced tool choice when asked", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    const tools: ToolSpec[] = [
      {
        name: "assign_task",
        description: "Give the task to a team member.",
        inputSchema: { type: "object" },
      },
    ];
    for await (const _ of adapter.complete([{ role: "user", content: "x" }], tools, {
      ...opts(),
      forceTool: "assign_task",
    })) {
      // drain
    }

    expect(captured().tools).toEqual([
      {
        name: "assign_task",
        description: "Give the task to a team member.",
        input_schema: { type: "object" },
      },
    ]);
    expect(captured().tool_choice).toEqual({ type: "tool", name: "assign_task" });
  });

  it("sends no tools key at all when there are none", async () => {
    const adapter = make();
    const { captured } = stub(adapter, [START, END]);
    await run(adapter, [{ role: "user", content: "x" }]);
    expect(captured().tools).toBeUndefined();
    expect(captured().tool_choice).toBeUndefined();
  });
});
