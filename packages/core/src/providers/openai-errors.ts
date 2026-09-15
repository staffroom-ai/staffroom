/**
 * OpenAI-compatible HTTP errors to our RunErrorCodes. The same mapping serves
 * Groq, Together, OpenRouter and anything else speaking the same protocol, so the
 * provider name comes in rather than being hard-coded.
 */
import { APIError } from "openai";
import { ProviderError } from "../runtime/errors.js";

export function mapOpenAIError(error: unknown, provider: string): unknown {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (!(error instanceof APIError)) return error;

  const status = error.status ?? 0;
  const detail = { provider };
  const base = { providerKind: "openai", status };

  if (status === 401 || status === 403) return new ProviderError("AUTH_FAILED", detail, base);
  if (status === 404) return new ProviderError("MODEL_NOT_FOUND", detail, base);
  if (status === 429) {
    const header = error.headers?.get?.("retry-after");
    return new ProviderError("RATE_LIMITED", detail, {
      ...base,
      retryable: true,
      retryAfterMs: header ? Number(header) * 1000 : 60_000,
    });
  }
  if (status === 400 && /context|too long|maximum context|max.*token/i.test(error.message)) {
    return new ProviderError("CONTEXT_TOO_LONG", detail, base);
  }
  // 5xx and network failures are worth another attempt; other 4xx are not.
  return new ProviderError("PROVIDER_UNAVAILABLE", detail, {
    ...base,
    ...(status >= 500 || status === 0 ? { retryable: true } : {}),
  });
}

/** True when a 400 is the endpoint objecting to stream_options rather than to the request. */
export function isStreamOptionsRejection(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status === 400 &&
    /stream_options|include_usage/i.test(error.message)
  );
}
