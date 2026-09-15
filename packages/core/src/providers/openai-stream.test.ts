/**
 * Exercises complete() against a scripted chat-completions stream. Covers the two
 * things that break when an endpoint is not quite OpenAI: interleaved tool-call
 * deltas, and endpoints that reject stream_options.
 */
import { APIError } from "openai";
import { describe, expect, it } from "vitest";
import { OpenAIAdapter } from "./openai.js";
import type { CompletionChunk, Message, ToolSpec } from "./types.js";

type Part = Record<string, unknown>;

interface Stub {
  /** Every request body the adapter sent, in order. */
  calls: () => Array<{ stream_options?: unknown }>;
}

/** Replaces chat.completions.create. `failWith` throws on the calls it names. */
function stub(
  adapter: OpenAIAdapter,
  parts: Part[],
  failWith?: { on: number[]; error: unknown },
): Stub {
  const calls: Array<{ stream_options?: unknown }> = [];
  const client = (adapter as unknown as { client: { chat: { completions: { create: unknown } } } })
    .client;

  client.chat.completions.create = (body: { stream_options?: unknown }) => {
    calls.push(body);
    if (failWith?.on.includes(calls.length)) return Promise.reject(failWith.error);
    return Promise.resolve({
      async *[Symbol.asyncIterator]() {
        for (const p of parts) yield p;
      },
    });
  };
  return { calls: () => calls };
}

const make = (options: Partial<ConstructorParameters<typeof OpenAIAdapter>[0]> = {}) =>
  new OpenAIAdapter({ apiKey: "sk-test-not-a-real-key", ...options });
const opts = () => ({ model: "gpt-5-mini", maxTokens: 256, signal: new AbortController().signal });

const USAGE = { usage: { prompt_tokens: 40, completion_tokens: 9 }, choices: [] };
const streamOptionsError = APIError.generate(
  400,
  { error: { message: "stream_options is not supported", type: "invalid_request_error" } },
  "stream_options is not supported",
  new Headers(),
);

async function run(
  adapter: OpenAIAdapter,
  messages: Message[] = [{ role: "user", content: "x" }],
  tools: ToolSpec[] = [],
): Promise<CompletionChunk[]> {
  const out: CompletionChunk[] = [];
  for await (const c of adapter.complete(messages, tools, opts())) out.push(c);
  return out;
}

describe("streaming", () => {
  it("yields text deltas and reports usage on done", async () => {
    const adapter = make();
    stub(adapter, [
      { choices: [{ index: 0, delta: { content: "North" } }] },
      { choices: [{ index: 0, delta: { content: "light" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      USAGE,
    ]);

    const chunks = await run(adapter);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("Northlight");
    expect(chunks.at(-1)).toEqual({
      type: "done",
      stopReason: "end",
      usage: { inputTokens: 40, outputTokens: 9 },
    });
  });

  it("reports cached input tokens when the endpoint gives them", async () => {
    const adapter = make();
    stub(adapter, [
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      {
        usage: {
          prompt_tokens: 40,
          completion_tokens: 9,
          prompt_tokens_details: { cached_tokens: 32 },
        },
        choices: [],
      },
    ]);
    expect(await run(adapter)).toContainEqual({
      type: "done",
      stopReason: "end",
      usage: { inputTokens: 40, outputTokens: 9, cachedInputTokens: 32 },
    });
  });

  it("emits tool calls at the finish reason, in index order", async () => {
    const adapter = make();
    stub(adapter, [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "c1", function: { name: "brain_search", arguments: '{"q":' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "c2",
                  function: { name: "brain_search", arguments: '{"q":"voice"}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"pricing"}' } }] },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      USAGE,
    ]);

    const chunks = await run(adapter);
    const calls = chunks.filter((c) => c.type === "tool_call");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      type: "tool_call",
      call: { id: "c1", name: "brain_search", input: { q: "pricing" } },
    });
    expect(calls[1]).toEqual({
      type: "tool_call",
      call: { id: "c2", name: "brain_search", input: { q: "voice" } },
    });
    expect(chunks.at(-1)).toMatchObject({ stopReason: "tool_calls" });
  });

  it("decodes a double-underscore tool name back to its dotted form", async () => {
    const adapter = make();
    stub(adapter, [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "c1", function: { name: "notion__search_pages", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    expect(await run(adapter)).toContainEqual({
      type: "tool_call",
      call: { id: "c1", name: "notion.search_pages", input: {} },
    });
  });

  it("maps length to the max_tokens stop reason", async () => {
    const adapter = make();
    stub(adapter, [{ choices: [{ index: 0, delta: {}, finish_reason: "length" }] }, USAGE]);
    expect(await run(adapter)).toContainEqual({
      type: "done",
      stopReason: "max_tokens",
      usage: { inputTokens: 40, outputTokens: 9 },
    });
  });

  it("ignores a part with no choices and no usage", async () => {
    const adapter = make();
    stub(adapter, [
      { choices: [] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      USAGE,
    ]);
    expect(await run(adapter)).toHaveLength(1);
  });

  it("maps a mid-stream failure through the error table", async () => {
    const adapter = make();
    const client = (
      adapter as unknown as { client: { chat: { completions: { create: unknown } } } }
    ).client;
    client.chat.completions.create = () =>
      Promise.resolve({
        // biome-ignore lint/correctness/useYield: a generator that only throws has nothing to yield.
        async *[Symbol.asyncIterator]() {
          throw APIError.generate(
            429,
            { error: { message: "slow down" } },
            "slow down",
            new Headers(),
          );
        },
      });
    await expect(run(adapter)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("stream_options fallback", () => {
  it("estimates usage and never sends stream_options twice to an endpoint that refused it", async () => {
    const adapter = make({ id: "lmstudio", label: "LM Studio" });
    const s = stub(
      adapter,
      [
        { choices: [{ index: 0, delta: { content: "hi" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ],
      { on: [1], error: streamOptionsError },
    );

    const first = await run(adapter, [{ role: "user", content: "a".repeat(35) }]);
    const done = first.at(-1);
    expect(done).toMatchObject({ type: "done", usage: { estimated: true, outputTokens: 0 } });
    if (done?.type === "done") expect(done.usage.inputTokens).toBeGreaterThan(0);

    // First attempt asked for usage, the retry did not.
    expect(s.calls()).toHaveLength(2);
    expect(s.calls()[0]?.stream_options).toEqual({ include_usage: true });
    expect(s.calls()[1]?.stream_options).toBeUndefined();

    // The second completion must not repeat the rejected request.
    await run(adapter);
    expect(s.calls()).toHaveLength(3);
    expect(s.calls()[2]?.stream_options).toBeUndefined();
  });

  it("never asks for usage when configured off", async () => {
    const adapter = make({ streamUsage: false });
    const s = stub(adapter, [{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]);
    await run(adapter);
    expect(s.calls()[0]?.stream_options).toBeUndefined();
  });

  it("does not retry a 400 that is about something else", async () => {
    const adapter = make();
    const other = APIError.generate(
      400,
      { error: { message: "bad model" } },
      "bad model",
      new Headers(),
    );
    const s = stub(adapter, [], { on: [1, 2], error: other });

    await expect(run(adapter)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(s.calls()).toHaveLength(1);
  });

  it("surfaces a failure on the retry rather than hanging", async () => {
    const adapter = make();
    const s = stub(adapter, [], { on: [1, 2], error: streamOptionsError });
    await expect(run(adapter)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(s.calls()).toHaveLength(2);
  });
});
