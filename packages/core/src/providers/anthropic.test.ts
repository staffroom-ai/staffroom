import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../runtime/errors.js";
import { AnthropicAdapter } from "./anthropic.js";
import { mapAnthropicError } from "./anthropic-errors.js";

const adapter = () => new AnthropicAdapter({ apiKey: "sk-ant-test-not-a-real-key" });

/** Builds a real APIError the way the SDK does, so the mapping is tested against the real class. */
function apiError(status: number, message = "boom", headers?: Record<string, string>): APIError {
  return Anthropic.APIError.generate(
    status,
    { error: { type: "error", message } },
    message,
    new Headers(headers ?? {}),
  ) as APIError;
}

describe("capabilities", () => {
  it("gives the claude-5 family a 200k context", () => {
    expect(adapter().capabilities("claude-sonnet-5").maxContextTokens).toBe(200_000);
    expect(adapter().capabilities("claude-opus-5").maxContextTokens).toBe(200_000);
  });

  it("reports an unknown context for anything else", () => {
    expect(adapter().capabilities("claude-haiku-4-5-20251001").maxContextTokens).toBeNull();
  });

  it("supports tools, streaming, parallel calls and forced tools", () => {
    const caps = adapter().capabilities("claude-sonnet-5");
    expect(caps).toMatchObject({
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsForcedTool: true,
    });
  });
});

describe("construction", () => {
  it("defaults its config id to anthropic", () => {
    expect(adapter().id).toBe("anthropic");
    expect(adapter().kind).toBe("anthropic");
    expect(adapter().defaultModel()).toBe("claude-sonnet-5");
  });

  it("accepts a custom id and baseURL, for a gateway or a proxy", () => {
    const via = new AnthropicAdapter({
      apiKey: "sk-ant-test-not-a-real-key",
      baseURL: "https://gateway.internal/anthropic",
      id: "anthropic-gateway",
    });
    expect(via.id).toBe("anthropic-gateway");
    expect((via as unknown as { client: { baseURL: string } }).client.baseURL).toBe(
      "https://gateway.internal/anthropic",
    );
  });
});

describe("pricing", () => {
  it("prices the shipped models", () => {
    expect(adapter().pricing("claude-sonnet-5")).toEqual({
      inputPer1k: 0.003,
      outputPer1k: 0.015,
      cachedInputPer1k: 0.0003,
    });
  });

  it("returns null for an unknown model so cost shows as unknown", () => {
    expect(adapter().pricing("claude-something-6")).toBeNull();
  });

  it("lets config override the shipped price", () => {
    const custom = new AnthropicAdapter({
      apiKey: "sk-ant-test-not-a-real-key",
      pricingOverrides: { "claude-sonnet-5": { inputPer1k: 0, outputPer1k: 0 } },
    });
    expect(custom.pricing("claude-sonnet-5")).toEqual({ inputPer1k: 0, outputPer1k: 0 });
  });
});

describe("error mapping", () => {
  it("maps 401 and 403 to AUTH_FAILED", () => {
    for (const status of [401, 403]) {
      const mapped = mapAnthropicError(apiError(status)) as ProviderError;
      expect(mapped).toBeInstanceOf(ProviderError);
      expect(mapped.code).toBe("AUTH_FAILED");
      expect(mapped.status).toBe(status);
      expect(mapped.retryable).toBe(false);
    }
  });

  it("maps 404 to MODEL_NOT_FOUND", () => {
    expect((mapAnthropicError(apiError(404)) as ProviderError).code).toBe("MODEL_NOT_FOUND");
  });

  it("maps 429 to RATE_LIMITED and honours retry-after", () => {
    const mapped = mapAnthropicError(
      apiError(429, "slow down", { "retry-after": "30" }),
    ) as ProviderError;
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryAfterMs).toBe(30_000);
    expect(mapped.retryable).toBe(true);
  });

  it("defaults 429 without a retry-after to a minute", () => {
    expect((mapAnthropicError(apiError(429)) as ProviderError).retryAfterMs).toBe(60_000);
  });

  it("maps a 400 about context length to CONTEXT_TOO_LONG", () => {
    const mapped = mapAnthropicError(
      apiError(400, "prompt is too long: 250000 tokens"),
    ) as ProviderError;
    expect(mapped.code).toBe("CONTEXT_TOO_LONG");
  });

  it("maps another 400 to PROVIDER_UNAVAILABLE without marking it retryable", () => {
    const mapped = mapAnthropicError(apiError(400, "invalid request")) as ProviderError;
    expect(mapped.code).toBe("PROVIDER_UNAVAILABLE");
    expect(mapped.retryable).toBe(false);
  });

  it("marks 5xx retryable", () => {
    const mapped = mapAnthropicError(apiError(503)) as ProviderError;
    expect(mapped.code).toBe("PROVIDER_UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("passes an AbortError through untouched", () => {
    const abort = new DOMException("Aborted", "AbortError");
    expect(mapAnthropicError(abort)).toBe(abort);
  });

  it("passes a non-API error through untouched", () => {
    const other = new TypeError("something else");
    expect(mapAnthropicError(other)).toBe(other);
  });

  it("carries the provider name into the user-facing message", () => {
    const mapped = mapAnthropicError(apiError(401)) as ProviderError;
    expect(mapped.toJSON().message).toBe("Anthropic rejected the API key.");
    expect(mapped.toJSON().hint).toContain("Settings > Models");
  });
});

describe("listModels", () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/anthropic/models-list.json", import.meta.url)),
      "utf8",
    ),
  ) as { data: Array<{ id: string; created_at: string }> };

  it("returns ids newest first", async () => {
    const a = adapter();
    // Stub the SDK call rather than the network, so the sort is what is under test.
    (a as unknown as { client: { models: { list: () => Promise<unknown> } } }).client.models.list =
      () => Promise.resolve(fixture);

    await expect(a.listModels()).resolves.toEqual([
      { id: "claude-opus-5", created: "2026-05-20T00:00:00Z" },
      { id: "claude-sonnet-5", created: "2026-02-11T00:00:00Z" },
      { id: "claude-haiku-4-5-20251001", created: "2025-10-01T00:00:00Z" },
    ]);
  });

  it("maps a 401 to AUTH_FAILED", async () => {
    const a = adapter();
    (a as unknown as { client: { models: { list: () => Promise<unknown> } } }).client.models.list =
      () => Promise.reject(apiError(401));

    await expect(a.listModels()).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});
