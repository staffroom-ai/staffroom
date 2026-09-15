/**
 * Records a real provider exchange to a fixture file so the conformance suite can
 * replay it without a network or an API key.
 *
 * Every string written passes through redaction first. A recorded response that
 * still carries the key that produced it is a published secret the moment we tag a
 * release, and `scripts/lint/fixture-secrets.mjs` is the second line of defence,
 * not the first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CompleteOptions,
  CompletionChunk,
  Message,
  ProviderAdapter,
  ToolSpec,
} from "../providers/types.js";
import { RunError } from "../runtime/errors.js";

// SR-012 replaces this with the shared redactSecrets. Until then the same patterns
// the fixture-secrets lint script looks for.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-test-REDACTED"],
  [/\bkey-[A-Za-z0-9_-]{16,}/g, "key-test-REDACTED"],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/g, "Bearer REDACTED"],
];

export function redactForFixture(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function redactDeep<T>(value: T): T {
  return JSON.parse(redactForFixture(JSON.stringify(value))) as T;
}

export interface RecordOptions {
  /** Directory the fixture is written into. */
  dir: string;
  /** File name without the extension, for example "plain-text". */
  name: string;
}

/**
 * Runs one real completion and writes it to `<dir>/<name>.jsonl`. Returns the
 * chunks so a caller can assert on them as well.
 */
export async function recordFixture(
  adapter: ProviderAdapter,
  messages: Message[],
  tools: ToolSpec[],
  opts: CompleteOptions,
  options: RecordOptions,
): Promise<CompletionChunk[]> {
  const lines: string[] = [];
  const header = redactDeep({ request: { messages, tools, model: opts.model } });
  lines.push(JSON.stringify(header));

  const chunks: CompletionChunk[] = [];
  try {
    for await (const chunk of adapter.complete(messages, tools, opts)) {
      const clean = redactDeep(chunk);
      chunks.push(clean);
      lines.push(JSON.stringify(clean));
    }
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    lines.push(
      JSON.stringify({
        __error: redactDeep({
          code: error.code,
          detail: error.detail,
          ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        }),
      }),
    );
  }

  const path = join(options.dir, `${options.name}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return chunks;
}
