import { describe, expect, it } from "vitest";
import type { ProviderError } from "../runtime/errors.js";
import { OllamaAdapter } from "./ollama.js";
import { mapOllamaError } from "./ollama-errors.js";
import type { CompletionChunk, Message, ToolSpec } from "./types.js";

const make = () => new OllamaAdapter();
const opts = () => ({ model: "llama4", maxTokens: 256, signal: new AbortController().signal });

type Part = Record<string, unknown>;

/** Replaces client.chat with a scripted stream, capturing the request. */
function stub(
  adapter: OllamaAdapter,
  parts: Part[],
  throws?: unknown,
): { body: () => Record<string, unknown> } {
  let body: Record<string, unknown> = {};
  const client = (adapter as unknown as { client: { chat: unknown } }).client;
  client.chat = (sent: Record<string, unknown>) => {
    body = sent;
    if (throws) return Promise.reject(throws);
    return Promise.resolve({
      abort: () => undefined,
      async *[Symbol.asyncIterator]() {
        for (const p of parts) yield p;
      },
    });
  };
  return { body: () => body };
}

async function run(
  adapter: OllamaAdapter,
  messages: Message[] = [{ role: "user", content: "x" }],
  tools: ToolSpec[] = [],
) {
  const out: CompletionChunk[] = [];
  for await (const c of adapter.complete(messages, tools, opts())) out.push(c);
  return out;
}

const DONE = { done: true, prompt_eval_count: 30, eval_count: 7 };

describe("identity and capabilities", () => {
  it("is a local provider with no price", () => {
    const a = make();
    expect(a.id).toBe("ollama");
    expect(a.kind).toBe("ollama");
    expect(a.defaultModel()).toBe("llama4");
    // Not zero: a zero price would imply a metered call that happened to cost nothing.
    expect(a.pricing("llama4")).toBeNull();
  });

  it("does not support forced tools, so routing uses the text path", () => {
    expect(make().capabilities("llama4").supportsForcedTool).toBe(false);
  });

  it("reports an unknown context window rather than guessing", () => {
    expect(make().capabilities("llama4").maxContextTokens).toBeNull();
  });
});

describe("tool support detection", () => {
  const stubShow = (a: OllamaAdapter, impl: () => Promise<unknown>) => {
    (a as unknown as { client: { show: () => Promise<unknown> } }).client.show = impl;
  };

  it("believes the capabilities list when there is one", async () => {
    const a = make();
    stubShow(a, () => Promise.resolve({ capabilities: ["completion", "tools"] }));
    await expect(a.hasTools("llama4")).resolves.toBe(true);
    expect(a.capabilities("llama4").supportsTools).toBe(true);
  });

  it("says no when the model lists no tool capability", async () => {
    const a = make();
    stubShow(a, () => Promise.resolve({ capabilities: ["completion"], template: "{{ .Prompt }}" }));
    await expect(a.hasTools("gemma")).resolves.toBe(false);
    expect(a.capabilities("gemma").supportsTools).toBe(false);
  });

  it("falls back to reading the template", async () => {
    const a = make();
    stubShow(a, () => Promise.resolve({ template: "{{ if .Tools }}...{{ end }}" }));
    await expect(a.hasTools("custom")).resolves.toBe(true);
  });

  it("asks only once per model", async () => {
    const a = make();
    let calls = 0;
    stubShow(a, () => {
      calls++;
      return Promise.resolve({ capabilities: ["tools"] });
    });
    await a.hasTools("llama4");
    await a.hasTools("llama4");
    expect(calls).toBe(1);
  });

  it("assumes yes when show fails, and lets the call itself report", async () => {
    const a = make();
    stubShow(a, () => Promise.reject(new Error("no such model")));
    await expect(a.hasTools("mystery")).resolves.toBe(true);
  });
});

describe("streaming", () => {
  it("yields text and reports counts on done", async () => {
    const a = make();
    stub(a, [{ message: { content: "North" } }, { message: { content: "light" } }, DONE]);
    const chunks = await run(a);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("Northlight");
    expect(chunks.at(-1)).toEqual({
      type: "done",
      stopReason: "end",
      usage: { inputTokens: 30, outputTokens: 7 },
    });
  });

  it("assigns ids by position, because Ollama sends none", async () => {
    const a = make();
    stub(a, [
      {
        message: {
          tool_calls: [{ function: { name: "brain_search", arguments: { q: "pricing" } } }],
        },
      },
      { message: { tool_calls: [{ function: { name: "brain_read", arguments: { id: "n/1" } } }] } },
      DONE,
    ]);
    const calls = (await run(a)).filter((c) => c.type === "tool_call");
    expect(calls.map((c) => (c.type === "tool_call" ? c.call.id : ""))).toEqual([
      "call_1",
      "call_2",
    ]);
    expect(calls.at(-1)).toMatchObject({ call: { name: "brain_read" } });
  });

  it("decodes a double-underscore name back to its dotted form", async () => {
    const a = make();
    stub(a, [
      { message: { tool_calls: [{ function: { name: "notion__search_pages", arguments: {} } }] } },
      DONE,
    ]);
    expect(await run(a)).toContainEqual({
      type: "tool_call",
      call: { id: "call_1", name: "notion.search_pages", input: {} },
    });
  });

  it("stops with tool_calls when any call was made", async () => {
    const a = make();
    stub(a, [{ message: { tool_calls: [{ function: { name: "a", arguments: {} } }] } }, DONE]);
    expect(await run(a)).toContainEqual(
      expect.objectContaining({ type: "done", stopReason: "tool_calls" }),
    );
  });

  it("maps a length stop to max_tokens", async () => {
    const a = make();
    stub(a, [{ ...DONE, done_reason: "length" }]);
    expect(await run(a)).toContainEqual(expect.objectContaining({ stopReason: "max_tokens" }));
  });

  it("treats missing counts as zero rather than undefined", async () => {
    const a = make();
    stub(a, [{ done: true }]);
    expect(await run(a)).toContainEqual({
      type: "done",
      stopReason: "end",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("aborts mid-stream without a done", async () => {
    const a = make();
    const controller = new AbortController();
    stub(a, [{ message: { content: "a" } }, { message: { content: "b" } }, DONE]);
    controller.abort();

    const chunks: CompletionChunk[] = [];
    await expect(async () => {
      for await (const c of a.complete([{ role: "user", content: "x" }], [], {
        model: "llama4",
        maxTokens: 10,
        signal: controller.signal,
      })) {
        chunks.push(c);
      }
    }).rejects.toThrow(/abort/i);
    expect(chunks.filter((c) => c.type === "done")).toHaveLength(0);
  });
});

describe("message mapping", () => {
  it("encodes tool names on the way out", async () => {
    const a = make();
    const s = stub(a, [DONE]);
    await run(
      a,
      [{ role: "user", content: "x" }],
      [{ name: "notion.search_pages", description: "d", inputSchema: { type: "object" } }],
    );
    expect((s.body()["tools"] as Array<{ function: { name: string } }>)[0]?.function.name).toBe(
      "notion__search_pages",
    );
  });

  it("prefixes a failed tool result", async () => {
    const a = make();
    const s = stub(a, [DONE]);
    await run(a, [
      { role: "tool", toolCallId: "c1", name: "send", content: "timed out", isError: true },
    ]);
    expect((s.body()["messages"] as Array<{ content: string }>)[0]?.content).toBe(
      "ERROR: timed out",
    );
  });

  it("replays an assistant's tool calls as text, since there are no ids to correlate", async () => {
    const a = make();
    const s = stub(a, [DONE]);
    await run(a, [
      {
        role: "assistant",
        content: "Looking.",
        toolCalls: [{ id: "call_1", name: "brain_search", input: { q: "p" } }],
      },
    ]);
    expect((s.body()["messages"] as Array<{ content: string }>)[0]?.content).toBe(
      'Looking.\nbrain_search({"q":"p"})',
    );
  });

  it("sends no tools key when there are none", async () => {
    const a = make();
    const s = stub(a, [DONE]);
    await run(a);
    expect(s.body()["tools"]).toBeUndefined();
  });
});

describe("error mapping", () => {
  it("says Ollama is not running when the connection is refused", () => {
    const mapped = mapOllamaError(
      new Error("connect ECONNREFUSED 127.0.0.1:11434"),
      "llama4",
    ) as ProviderError;
    expect(mapped.code).toBe("PROVIDER_UNAVAILABLE");
    expect(mapped.toJSON().message).toBe("Ollama is not running.");
    expect(mapped.toJSON().hint).toContain("ollama.com");
    expect(mapped.retryable).toBe(true);
  });

  it("tells the owner to pull a model that is not there", () => {
    const mapped = mapOllamaError(new Error('model "llama4" not found'), "llama4") as ProviderError;
    expect(mapped.code).toBe("MODEL_NOT_FOUND");
    expect(mapped.toJSON().message).toBe("Ollama does not have llama4 yet.");
    expect(mapped.toJSON().hint).toBe("Open Terminal and run: ollama pull llama4 (about 5 GB).");
  });

  it("maps a 404 status the same way", () => {
    const err = Object.assign(new Error("nope"), { status_code: 404 });
    expect((mapOllamaError(err, "llama4") as ProviderError).code).toBe("MODEL_NOT_FOUND");
  });

  it("maps a context overflow", () => {
    expect(
      (mapOllamaError(new Error("context length exceeded"), "llama4") as ProviderError).code,
    ).toBe("CONTEXT_TOO_LONG");
  });

  it("passes an AbortError and a non-Error through", () => {
    const abort = new DOMException("Aborted", "AbortError");
    expect(mapOllamaError(abort, "llama4")).toBe(abort);
    expect(mapOllamaError("a string", "llama4")).toBe("a string");
  });

  it("wraps the stream failure rather than leaking the raw error", async () => {
    const a = make();
    stub(a, [], new Error("connect ECONNREFUSED 127.0.0.1:11434"));
    await expect(run(a)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("listModels", () => {
  it("returns installed models newest first", async () => {
    const a = make();
    (a as unknown as { client: { list: () => Promise<unknown> } }).client.list = () =>
      Promise.resolve({
        models: [
          { name: "llama4:latest", modified_at: "2026-01-10T00:00:00Z" },
          { name: "mistral:latest", modified_at: "2026-06-01T00:00:00Z" },
        ],
      });
    await expect(a.listModels()).resolves.toEqual([
      { id: "mistral:latest", created: "2026-06-01T00:00:00.000Z" },
      { id: "llama4:latest", created: "2026-01-10T00:00:00.000Z" },
    ]);
  });

  it("reports Ollama not running rather than an empty list", async () => {
    const a = make();
    (a as unknown as { client: { list: () => Promise<unknown> } }).client.list = () =>
      Promise.reject(new Error("fetch failed"));
    await expect(a.listModels()).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
