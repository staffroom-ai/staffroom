import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APIError } from "openai";
import { describe, expect, it } from "vitest";
import type { ProviderError } from "../runtime/errors.js";
import { OpenAIAdapter } from "./openai.js";
import { isStreamOptionsRejection, mapOpenAIError } from "./openai-errors.js";
import { toOpenAIMessages, toOpenAIRequest, toOpenAITools } from "./openai-messages.js";
import { parseArguments, ToolCallBuffer } from "./openai-stream.js";
import type { Message, ToolSpec } from "./types.js";

const adapter = (options: Partial<ConstructorParameters<typeof OpenAIAdapter>[0]> = {}) =>
  new OpenAIAdapter({ apiKey: "sk-test-not-a-real-key", ...options });

function apiError(status: number, message = "boom", headers?: Record<string, string>): APIError {
  return APIError.generate(
    status,
    { error: { message, type: "invalid_request_error" } },
    message,
    new Headers(headers ?? {}),
  ) as APIError;
}

const SEARCH: ToolSpec = {
  name: "notion.search_pages",
  description: "Search Notion.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
};

describe("construction", () => {
  it("defaults to openai and prices from the shipped table", () => {
    expect(adapter().id).toBe("openai");
    expect(adapter().kind).toBe("openai");
    expect(adapter().defaultModel()).toBe("gpt-5-mini");
    expect(adapter().pricing("gpt-5-mini")).toMatchObject({ inputPer1k: 0.00025 });
  });

  it("gives a compatible endpoint no shipped prices, so config must supply them", () => {
    const groq = adapter({ id: "groq", baseURL: "https://api.groq.com/openai/v1" });
    expect(groq.pricing("gpt-5-mini")).toBeNull();
    expect(groq.pricing("llama-4-70b")).toBeNull();
  });

  it("takes prices for a compatible endpoint from config", () => {
    const groq = adapter({
      id: "groq",
      pricingOverrides: { "llama-4-70b": { inputPer1k: 0.0001, outputPer1k: 0.0003 } },
    });
    expect(groq.pricing("llama-4-70b")).toEqual({ inputPer1k: 0.0001, outputPer1k: 0.0003 });
  });

  it("reports the context window it was configured with", () => {
    expect(adapter().capabilities("gpt-5").maxContextTokens).toBeNull();
    expect(adapter({ maxContextTokens: 128_000 }).capabilities("gpt-5").maxContextTokens).toBe(
      128_000,
    );
  });
});

describe("message mapping", () => {
  it("sends a dotted tool name as a double underscore", () => {
    expect(toOpenAITools([SEARCH])[0]?.function.name).toBe("notion__search_pages");
  });

  it("encodes the name on an assistant tool call too", () => {
    const mapped = toOpenAIMessages([
      {
        role: "assistant",
        content: "looking",
        toolCalls: [{ id: "c1", name: "notion.search_pages", input: { query: "pricing" } }],
      },
    ]);
    expect(mapped[0]).toMatchObject({
      role: "assistant",
      content: "looking",
      tool_calls: [{ id: "c1", type: "function", function: { name: "notion__search_pages" } }],
    });
  });

  it("sends null content when the assistant only called tools", () => {
    const mapped = toOpenAIMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "now", input: {} }] },
    ]);
    expect(mapped[0]).toMatchObject({ content: null });
  });

  it("prefixes a failed tool result, since the protocol has no error flag", () => {
    const mapped = toOpenAIMessages([
      { role: "tool", toolCallId: "c1", name: "send", content: "timed out", isError: true },
    ]);
    expect(mapped[0]).toEqual({ role: "tool", tool_call_id: "c1", content: "ERROR: timed out" });
  });

  it("leaves a successful tool result unprefixed", () => {
    const mapped = toOpenAIMessages([
      { role: "tool", toolCallId: "c1", name: "send", content: "sent" },
    ]);
    expect(mapped[0]).toMatchObject({ content: "sent" });
  });

  it("keeps system and user turns as they are", () => {
    const messages: Message[] = [
      { role: "system", content: "You are Priya." },
      { role: "user", content: "hi" },
    ];
    expect(toOpenAIMessages(messages)).toEqual([
      { role: "system", content: "You are Priya." },
      { role: "user", content: "hi" },
    ]);
  });
});

describe("request building", () => {
  const opts = () => ({
    model: "gpt-5-mini",
    maxTokens: 256,
    signal: new AbortController().signal,
  });

  it("asks for usage when the endpoint supports it", () => {
    expect(toOpenAIRequest([{ role: "user", content: "x" }], [], opts(), true)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 256,
    });
  });

  it("omits stream_options when it does not", () => {
    expect(
      toOpenAIRequest([{ role: "user", content: "x" }], [], opts(), false).stream_options,
    ).toBeUndefined();
  });

  it("encodes a forced tool name", () => {
    const body = toOpenAIRequest(
      [{ role: "user", content: "x" }],
      [SEARCH],
      { ...opts(), forceTool: "notion.search_pages" },
      true,
    );
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "notion__search_pages" },
    });
  });

  it("sends no tools key when there are none", () => {
    const body = toOpenAIRequest([{ role: "user", content: "x" }], [], opts(), true);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("ToolCallBuffer", () => {
  it("assembles a call split across deltas and decodes the name", () => {
    const buffer = new ToolCallBuffer();
    buffer.add([{ index: 0, id: "c1", function: { name: "notion__search", arguments: '{"q":' } }]);
    buffer.add([{ index: 0, function: { arguments: '"pricing"}' } }]);
    expect(buffer.flush()).toEqual([{ id: "c1", name: "notion.search", input: { q: "pricing" } }]);
  });

  it("assembles a name that itself arrives in pieces", () => {
    const buffer = new ToolCallBuffer();
    buffer.add([{ index: 0, id: "c1", function: { name: "brain_" } }]);
    buffer.add([{ index: 0, function: { name: "search", arguments: "{}" } }]);
    expect(buffer.flush()[0]?.name).toBe("brain_search");
  });

  it("keeps interleaved calls apart and returns them in index order", () => {
    const buffer = new ToolCallBuffer();
    buffer.add([
      { index: 1, id: "c2", function: { name: "b", arguments: "{}" } },
      { index: 0, id: "c1", function: { name: "a", arguments: "{}" } },
    ]);
    expect(buffer.flush().map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("invents an id by position when the endpoint sends none", () => {
    const buffer = new ToolCallBuffer();
    buffer.add([{ index: 0, function: { name: "a", arguments: "{}" } }]);
    expect(buffer.flush()[0]?.id).toBe("call_1");
  });

  it("empties on flush", () => {
    const buffer = new ToolCallBuffer();
    buffer.add([{ index: 0, id: "c1", function: { name: "a", arguments: "{}" } }]);
    expect(buffer.flush()).toHaveLength(1);
    expect(buffer.flush()).toHaveLength(0);
  });
});

describe("parseArguments", () => {
  it("parses json", () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
  });

  it("treats empty as no arguments", () => {
    expect(parseArguments("   ")).toEqual({});
  });

  it("hands unparseable text to the loop as _raw", () => {
    expect(parseArguments("{not json")).toEqual({ _raw: "{not json" });
  });
});

describe("error mapping", () => {
  it("maps the status codes", () => {
    expect((mapOpenAIError(apiError(401), "OpenAI") as ProviderError).code).toBe("AUTH_FAILED");
    expect((mapOpenAIError(apiError(404), "OpenAI") as ProviderError).code).toBe("MODEL_NOT_FOUND");
    expect((mapOpenAIError(apiError(503), "OpenAI") as ProviderError).code).toBe(
      "PROVIDER_UNAVAILABLE",
    );
  });

  it("honours retry-after on 429", () => {
    const mapped = mapOpenAIError(
      apiError(429, "slow", { "retry-after": "12" }),
      "Groq",
    ) as ProviderError;
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryAfterMs).toBe(12_000);
    expect(mapped.retryable).toBe(true);
  });

  it("maps a context-length 400 to CONTEXT_TOO_LONG", () => {
    const mapped = mapOpenAIError(
      apiError(400, "maximum context length is 128000 tokens"),
      "OpenAI",
    ) as ProviderError;
    expect(mapped.code).toBe("CONTEXT_TOO_LONG");
  });

  it("names the provider it was given, so Groq errors do not say OpenAI", () => {
    const mapped = mapOpenAIError(apiError(401), "Groq") as ProviderError;
    expect(mapped.toJSON().message).toBe("Groq rejected the API key.");
  });

  it("passes an AbortError and a non-API error through", () => {
    const abort = new DOMException("Aborted", "AbortError");
    const other = new TypeError("nope");
    expect(mapOpenAIError(abort, "OpenAI")).toBe(abort);
    expect(mapOpenAIError(other, "OpenAI")).toBe(other);
  });

  it("recognises a stream_options rejection and nothing else", () => {
    expect(isStreamOptionsRejection(apiError(400, "stream_options is not supported"))).toBe(true);
    expect(isStreamOptionsRejection(apiError(400, "include_usage unsupported"))).toBe(true);
    expect(isStreamOptionsRejection(apiError(400, "something else"))).toBe(false);
    expect(isStreamOptionsRejection(apiError(429, "stream_options"))).toBe(false);
    expect(isStreamOptionsRejection(new TypeError("stream_options"))).toBe(false);
  });
});

describe("listModels", () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/openai/models-list.json", import.meta.url)),
      "utf8",
    ),
  ) as { data: Array<{ id: string; created: number }> };

  const stubList = (a: OpenAIAdapter, impl: () => Promise<unknown>) => {
    (a as unknown as { client: { models: { list: () => Promise<unknown> } } }).client.models.list =
      impl;
  };

  it("returns ids newest first with created as an ISO date", async () => {
    const a = adapter();
    stubList(a, () => Promise.resolve(fixture));
    await expect(a.listModels()).resolves.toEqual([
      { id: "gpt-5", created: "2026-03-03T00:00:00.000Z" },
      { id: "gpt-5-mini", created: "2026-02-01T00:00:00.000Z" },
      { id: "gpt-5-nano", created: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("returns an empty list for an endpoint with no models route", async () => {
    const a = adapter({ id: "lmstudio", baseURL: "http://localhost:1234/v1" });
    stubList(a, () => Promise.reject(apiError(404)));
    await expect(a.listModels()).resolves.toEqual([]);
  });

  it("still throws on a real failure such as a bad key", async () => {
    const a = adapter();
    stubList(a, () => Promise.reject(apiError(401)));
    await expect(a.listModels()).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("returns an empty list when the endpoint reports no models", async () => {
    const a = adapter();
    stubList(a, () => Promise.resolve({ data: [] }));
    await expect(a.listModels()).resolves.toEqual([]);
  });
});
