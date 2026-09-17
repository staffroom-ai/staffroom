/**
 * What each configured provider says it can run today.
 *
 * The default-model select is populated from this rather than from a list
 * Staffroom ships, because a list Staffroom ships is out of date the week after
 * a release and the owner is the one who finds out — by picking a model that no
 * longer exists and getting a failure three screens later.
 *
 * A provider that cannot answer is a row with an `error`, never a missing row.
 * Dropping it would put the owner in front of a select that says they have no
 * Anthropic models when the truth is that their key was refused, on the one
 * screen where they could fix it.
 */
import type { ModelInfo, Office } from "@staffroom/core";

export interface ProviderModels {
  id: string;
  models: ModelInfo[];
  error?: string;
}

/**
 * How long to wait on a provider before giving up on it.
 *
 * Somebody is looking at a spinner. A provider that is slow because a laptop is
 * on hotel wifi should not hold up the three that already answered, and Ollama
 * pointed at a machine that is off would otherwise hang until the socket did.
 */
export const LIST_TIMEOUT_MS = 8_000;

/** The demo adapter has nothing to offer a model select. */
const NOT_A_CHOICE = new Set(["demo"]);

export async function listProviderModels(office: Office): Promise<ProviderModels[]> {
  const entries = [...office.providers.entries()].filter(([id]) => !NOT_A_CHOICE.has(id));

  // All at once: they are independent network calls and the owner is waiting.
  return Promise.all(
    entries.map(async ([id, adapter]): Promise<ProviderModels> => {
      try {
        const models = await withTimeout(adapter.listModels(), LIST_TIMEOUT_MS);
        // Newest first, and anything undated after everything dated: a provider
        // that reports no dates should not scatter its models through the list.
        const sorted = [...models].sort((a, b) => {
          if (a.created === undefined && b.created === undefined) return a.id.localeCompare(b.id);
          if (a.created === undefined) return 1;
          if (b.created === undefined) return -1;
          return Date.parse(b.created) - Date.parse(a.created);
        });
        return { id, models: sorted };
      } catch (error) {
        return { id, models: [], error: reason(error) };
      }
    }),
  );
}

/** A sentence somebody can act on, never a stack trace. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 200 ? `${message.slice(0, 200).trimEnd()}…` : message;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error(`No answer within ${ms / 1000} seconds.`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
