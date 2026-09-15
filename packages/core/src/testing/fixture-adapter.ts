/**
 * Replays recorded provider responses. This is the only replay implementation in
 * the repository and it has two jobs:
 *
 * 1. Adapter conformance tests run every adapter against the same seven recorded
 *    exchanges, with no network.
 * 2. Demo mode plays scripted runs so a first-time visitor sees the office working
 *    before they have configured any provider.
 *
 * File format is JSON Lines. The first line is a header, the rest are chunks:
 *
 *   {"request": {"messages": [...], "tools": [...], "model": "..."}}   <- adapter fixture
 *   {"matches": ["newsletter", "draft"], "delayMs": 40}                <- demo run
 *   {"type": "text", "text": "Hello"}
 *   {"type": "done", "stopReason": "end", "usage": {...}}
 *
 * A line of the form {"__error": {...}} makes the replay throw instead, which is
 * how the provider-error fixtures work.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  CompleteOptions,
  CompletionChunk,
  Message,
  ModelInfo,
  ModelPricing,
  ProviderAdapter,
  ProviderCapabilities,
  ToolSpec,
} from "../providers/types.js";
import { ProviderError, type RunErrorCode } from "../runtime/errors.js";

export interface FixtureHeader {
  /** Adapter fixtures: the exact request this file was recorded for. */
  request?: { messages: Message[]; tools?: ToolSpec[]; model?: string };
  /** Demo runs: keywords scored against the task text. */
  matches?: string[];
  /** Per-chunk delay before scaling by speed. */
  delayMs?: number;
}

interface FixtureError {
  code: RunErrorCode;
  detail?: Record<string, string | number>;
  retryAfterMs?: number;
  status?: number;
}

interface Fixture {
  name: string;
  header: FixtureHeader;
  chunks: CompletionChunk[];
  error?: FixtureError;
}

export interface FixtureAdapterOptions {
  /** Milliseconds between chunks. 0 makes tests instant. */
  delayMs?: number;
  /** Demo playback speed. Delay is divided by this. */
  speed?: number;
}

/** Stable hash of a request, so a recorded file can be found again exactly. */
export function hashRequest(messages: Message[], tools: ToolSpec[], model?: string): string {
  const canonical = JSON.stringify({
    messages,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    ...(model === undefined ? {} : { model }),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function parseFixture(name: string, text: string): Fixture {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`fixture ${name} is empty`);

  const header = JSON.parse(lines[0] as string) as FixtureHeader;
  const chunks: CompletionChunk[] = [];
  let error: FixtureError | undefined;

  for (const line of lines.slice(1)) {
    const parsed = JSON.parse(line) as CompletionChunk | { __error: FixtureError };
    if ("__error" in parsed) error = parsed.__error;
    else chunks.push(parsed);
  }
  return error === undefined ? { name, header, chunks } : { name, header, chunks, error };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FixtureAdapter implements ProviderAdapter {
  readonly id = "demo";
  readonly kind = "demo" as const;

  private readonly fixtures: Fixture[] = [];
  private readonly delayMs: number;
  private speed: number;

  constructor(dir: string, options: FixtureAdapterOptions = {}) {
    this.delayMs = options.delayMs ?? 40;
    this.speed = options.speed ?? 1;

    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()) {
      this.fixtures.push(
        parseFixture(basename(file, ".jsonl"), readFileSync(join(dir, file), "utf8")),
      );
    }
    if (this.fixtures.length === 0) throw new Error(`no .jsonl fixtures in ${dir}`);
  }

  /** Demo playback speed: 1, 2 or 4. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  defaultModel(): string {
    return "demo";
  }

  capabilities(_model: string): ProviderCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsForcedTool: true,
      maxContextTokens: null,
    };
  }

  pricing(_model: string): ModelPricing | null {
    // Nothing was spent replaying a file, and showing $0.00 would imply a real call.
    return null;
  }

  countTokens(): Promise<number> {
    return Promise.resolve(0);
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([{ id: "demo" }]);
  }

  /** Exposed for tests and for demo mode's "which transcript ran" line. */
  select(messages: Message[], tools: ToolSpec[] = [], model?: string): Fixture {
    const byHash = hashRequest(messages, tools, model);
    const exact = this.fixtures.find(
      (f) =>
        f.header.request &&
        hashRequest(
          f.header.request.messages,
          f.header.request.tools ?? [],
          f.header.request.model,
        ) === byHash,
    );
    if (exact) return exact;

    const keyworded = this.fixtures.filter((f) => f.header.matches && f.header.matches.length > 0);
    if (keyworded.length > 0) {
      // Only what was actually asked. Scoring the system prompt too would let a
      // pinned note about pricing pull every task towards the pricing transcript.
      const haystack = messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join(" ")
        .toLowerCase();
      let best: Fixture | undefined;
      let bestScore = 0;
      for (const f of keyworded) {
        const score = (f.header.matches ?? []).filter((k) =>
          haystack.includes(k.toLowerCase()),
        ).length;
        if (score > bestScore) {
          best = f;
          bestScore = score;
        }
      }
      if (best) return best;
    }

    const generic = this.fixtures.find((f) => f.name === "generic");
    if (generic) return generic;

    throw new Error(
      `no fixture matched and there is no generic.jsonl (have: ${this.fixtures.map((f) => f.name).join(", ")})`,
    );
  }

  async *complete(
    messages: Message[],
    tools: ToolSpec[],
    opts: CompleteOptions,
  ): AsyncIterable<CompletionChunk> {
    const fixture = this.select(messages, tools, opts.model);
    const delay = (fixture.header.delayMs ?? this.delayMs) / this.speed;

    if (fixture.error) {
      const { code, detail = {}, retryAfterMs, status } = fixture.error;
      throw new ProviderError(code, detail, {
        providerKind: "demo",
        ...(retryAfterMs === undefined ? {} : { retryAfterMs, retryable: true }),
        ...(status === undefined ? {} : { status }),
      });
    }

    for (const chunk of fixture.chunks) {
      // Checked before every chunk, including the first, so an already-aborted
      // signal produces no output at all.
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (delay > 0) await sleep(delay);
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      yield chunk;
    }
  }
}
