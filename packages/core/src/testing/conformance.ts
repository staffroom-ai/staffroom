/**
 * The shared adapter conformance suite.
 *
 * Every adapter replays the same seven exchanges and must behave identically. This
 * is what keeps "adding a provider takes under 150 lines" true: the rules live
 * here, once, instead of in each adapter's own tests.
 */
import { expect, it } from "vitest";
import type { CompletionChunk, Message, ProviderAdapter, ToolSpec } from "../providers/types.js";
import { ProviderError } from "../runtime/errors.js";

export const CONFORMANCE_FIXTURES = [
  "plain-text",
  "single-tool-call",
  "parallel-tool-calls",
  "tool-result-roundtrip",
  "streaming-mid-word",
  "empty-response",
  "provider-error-429",
] as const;

export type ConformanceFixture = (typeof CONFORMANCE_FIXTURES)[number];

const SEARCH_TOOL: ToolSpec = {
  name: "brain_search",
  description: "Search the notes.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

/** The request each fixture was recorded for. */
export const CONFORMANCE_REQUESTS: Record<
  ConformanceFixture,
  { messages: Message[]; tools: ToolSpec[] }
> = {
  "plain-text": { messages: [{ role: "user", content: "Say hello." }], tools: [] },
  "single-tool-call": {
    messages: [{ role: "user", content: "What does the pricing note say?" }],
    tools: [SEARCH_TOOL],
  },
  "parallel-tool-calls": {
    messages: [{ role: "user", content: "Check pricing and the brand voice." }],
    tools: [SEARCH_TOOL],
  },
  "tool-result-roundtrip": {
    messages: [
      { role: "user", content: "What does the pricing note say?" },
      {
        role: "assistant",
        content: "Let me look that up.",
        toolCalls: [{ id: "call_1", name: "brain_search", input: { query: "pricing" } }],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        name: "brain_search",
        content: "Standard day rate is 1200 AUD.",
      },
    ],
    tools: [SEARCH_TOOL],
  },
  "streaming-mid-word": { messages: [{ role: "user", content: "Name the company." }], tools: [] },
  "empty-response": { messages: [{ role: "user", content: "" }], tools: [] },
  "provider-error-429": {
    messages: [{ role: "user", content: "Trigger a rate limit." }],
    tools: [],
  },
};

async function drain(
  adapter: ProviderAdapter,
  fixture: ConformanceFixture,
  model: string,
  signal = new AbortController().signal,
): Promise<CompletionChunk[]> {
  const { messages, tools } = CONFORMANCE_REQUESTS[fixture];
  const chunks: CompletionChunk[] = [];
  for await (const chunk of adapter.complete(messages, tools, { model, maxTokens: 1024, signal })) {
    chunks.push(chunk);
  }
  return chunks;
}

export interface ConformanceTarget {
  name: string;
  make(): ProviderAdapter;
  model: string;
}

/**
 * Call inside a `describe` block. Adds one `it` per rule.
 */
export function runConformanceSuite(target: ConformanceTarget): void {
  const make = () => target.make();

  it("streams text and ends with exactly one done", async () => {
    const chunks = await drain(make(), "plain-text", target.model);
    const done = chunks.filter((c) => c.type === "done");
    expect(done).toHaveLength(1);
    expect(chunks.at(-1)?.type).toBe("done");
    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text.length).toBeGreaterThan(0);
  });

  it("reports usage on done", async () => {
    const chunks = await drain(make(), "plain-text", target.model);
    const done = chunks.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(done.usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(done.stopReason).toBe("end");
    }
  });

  it("yields a tool call and stops with tool_calls", async () => {
    const chunks = await drain(make(), "single-tool-call", target.model);
    const calls = chunks.filter((c) => c.type === "tool_call");
    expect(calls).toHaveLength(1);
    if (calls[0]?.type === "tool_call") {
      expect(calls[0].call.name).toBe("brain_search");
      expect(calls[0].call.id.length).toBeGreaterThan(0);
      expect(calls[0].call.input).toHaveProperty("query");
    }
    const done = chunks.at(-1);
    if (done?.type === "done") expect(done.stopReason).toBe("tool_calls");
  });

  it("yields parallel tool calls with distinct ids", async () => {
    const chunks = await drain(make(), "parallel-tool-calls", target.model);
    const calls = chunks.filter((c) => c.type === "tool_call");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const ids = calls.map((c) => (c.type === "tool_call" ? c.call.id : ""));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries on after a tool result", async () => {
    const chunks = await drain(make(), "tool-result-roundtrip", target.model);
    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toContain("1200");
    const done = chunks.at(-1);
    if (done?.type === "done") expect(done.stopReason).toBe("end");
  });

  it("may split text mid-word across chunks", async () => {
    const chunks = await drain(make(), "streaming-mid-word", target.model);
    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toContain("Northlight");
  });

  it("handles a response with no text at all", async () => {
    const chunks = await drain(make(), "empty-response", target.model);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("");
    expect(chunks.at(-1)?.type).toBe("done");
  });

  it("throws a mapped ProviderError rather than retrying", async () => {
    await expect(drain(make(), "provider-error-429", target.model)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).code).toBe("RATE_LIMITED");
        expect((error as ProviderError).retryAfterMs).toBeGreaterThan(0);
        return true;
      },
    );
  });

  it("throws AbortError and yields no done when the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const chunks: CompletionChunk[] = [];
    await expect(async () => {
      const { messages, tools } = CONFORMANCE_REQUESTS["plain-text"];
      for await (const chunk of make().complete(messages, tools, {
        model: target.model,
        maxTokens: 1024,
        signal: controller.signal,
      })) {
        chunks.push(chunk);
      }
    }).rejects.toThrow(/abort/i);
    expect(chunks.filter((c) => c.type === "done")).toHaveLength(0);
  });
}
