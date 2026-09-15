/**
 * Anthropic's HTTP errors to our RunErrorCodes. Kept beside the adapter rather than
 * inside it so the adapter stays under the 150-line budget that keeps "adding a
 * provider is easy" true.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../runtime/errors.js";

const DETAIL = { provider: "Anthropic" };

export function mapAnthropicError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (!(error instanceof Anthropic.APIError)) return error;

  const status = error.status ?? 0;
  const base = { providerKind: "anthropic", status };

  if (status === 401 || status === 403) return new ProviderError("AUTH_FAILED", DETAIL, base);
  if (status === 404) return new ProviderError("MODEL_NOT_FOUND", DETAIL, base);
  if (status === 429) {
    const header = error.headers?.get?.("retry-after");
    return new ProviderError("RATE_LIMITED", DETAIL, {
      ...base,
      retryable: true,
      retryAfterMs: header ? Number(header) * 1000 : 60_000,
    });
  }
  if (status === 400 && /context|too long|max.*token/i.test(error.message)) {
    return new ProviderError("CONTEXT_TOO_LONG", DETAIL, base);
  }
  // 5xx and network failures are worth another attempt; other 4xx are not.
  return new ProviderError("PROVIDER_UNAVAILABLE", DETAIL, {
    ...base,
    ...(status >= 500 || status === 0 ? { retryable: true } : {}),
  });
}
