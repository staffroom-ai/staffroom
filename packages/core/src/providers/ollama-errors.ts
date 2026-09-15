/**
 * Ollama fails differently from a hosted provider, and the difference matters to
 * the person reading it: "not found" means `ollama pull`, and "unavailable" means
 * the app is not running. Both hints assume nothing is installed yet.
 */
import { ProviderError } from "../runtime/errors.js";

const CONNECTION = /ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET|socket hang up|network/i;
const NOT_FOUND = /not found|no such model|pull the model|try pulling/i;

export function mapOllamaError(error: unknown, model: string): unknown {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (!(error instanceof Error)) return error;

  const base = { providerKind: "ollama" };
  const message = error.message;
  const status =
    (error as { status_code?: number; status?: number }).status_code ??
    (error as { status?: number }).status;

  if (CONNECTION.test(message)) {
    return new ProviderError("PROVIDER_UNAVAILABLE", {}, { ...base, retryable: true });
  }
  if (status === 404 || NOT_FOUND.test(message)) {
    return new ProviderError("MODEL_NOT_FOUND", { model }, base);
  }
  if (/context length|too long|exceeds/i.test(message)) {
    return new ProviderError("CONTEXT_TOO_LONG", { model }, base);
  }
  return new ProviderError("PROVIDER_UNAVAILABLE", {}, base);
}
