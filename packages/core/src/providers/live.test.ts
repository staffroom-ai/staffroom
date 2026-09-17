/**
 * The adapters against the real providers, to catch drift.
 *
 * Fixtures prove an adapter still handles the exchange it was recorded against.
 * They cannot prove the provider still sends that exchange. Providers change
 * their streaming shapes, their error bodies and their model names without
 * telling anybody, and the way that reaches an owner today is their office
 * failing on a Tuesday for no reason they can see.
 *
 * So this runs nightly against the real thing. It is deliberately small: three
 * assertions per provider, chosen because they are the three shapes an adapter
 * has to get right and the three most likely to move.
 *
 * Skipped unless `STAFFROOM_LIVE_TESTS=1`, and each provider skipped again
 * unless its credential is present, so a contributor running `pnpm test` never
 * spends anybody's money or waits on a network.
 */
import { describe, expect, it } from "vitest";
import { RunError } from "../runtime/errors.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenAIAdapter } from "./openai.js";
import type { CompletionChunk, ProviderAdapter, ToolSpec } from "./types.js";

const LIVE = process.env["STAFFROOM_LIVE_TESTS"] === "1";

/** Small, cheap and universally available on each provider. */
const MODELS = {
  anthropic: process.env["STAFFROOM_LIVE_ANTHROPIC_MODEL"] ?? "claude-haiku-4-5-20251001",
  openai: process.env["STAFFROOM_LIVE_OPENAI_MODEL"] ?? "gpt-5-mini",
  ollama: process.env["STAFFROOM_LIVE_OLLAMA_MODEL"] ?? "llama3.2:1b",
};

const LOOKUP: ToolSpec = {
  name: "brain_search",
  description: "Search the business's notes. Use this to answer questions about the business.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
};

async function collect(stream: AsyncIterable<CompletionChunk>): Promise<CompletionChunk[]> {
  const chunks: CompletionChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const textOf = (chunks: CompletionChunk[]): string =>
  chunks
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("");

interface Target {
  name: string;
  model: string;
  /** Absent means this provider has no credential here, so it is skipped. */
  make: (() => ProviderAdapter) | undefined;
  /** An adapter built with a credential that cannot work. */
  broken: (() => ProviderAdapter) | undefined;
}

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const openaiKey = process.env["OPENAI_API_KEY"];
const ollamaUrl = process.env["OLLAMA_HOST"] ?? process.env["STAFFROOM_LIVE_OLLAMA_URL"];

const TARGETS: Target[] = [
  {
    name: "anthropic",
    model: MODELS.anthropic,
    make:
      anthropicKey === undefined ? undefined : () => new AnthropicAdapter({ apiKey: anthropicKey }),
    broken: () => new AnthropicAdapter({ apiKey: "sk-ant-not-a-real-key" }),
  },
  {
    name: "openai",
    model: MODELS.openai,
    make: openaiKey === undefined ? undefined : () => new OpenAIAdapter({ apiKey: openaiKey }),
    broken: () => new OpenAIAdapter({ apiKey: "sk-not-a-real-key" }),
  },
  {
    name: "ollama",
    model: MODELS.ollama,
    make: ollamaUrl === undefined ? undefined : () => new OllamaAdapter({ baseUrl: ollamaUrl }),
    // Ollama has no key to get wrong. Pointed at a port nothing is listening on,
    // which is the failure an owner actually hits: it is not running.
    broken: () => new OllamaAdapter({ baseUrl: "http://127.0.0.1:1" }),
  },
];

describe.skipIf(!LIVE)("against the real providers", () => {
  for (const target of TARGETS) {
    describe.skipIf(target.make === undefined)(target.name, () => {
      // Real network calls on a shared runner. Generous, because a slow answer
      // is not the drift this is looking for.
      const timeout = 90_000;

      it(
        "streams text and ends with exactly one done",
        async () => {
          const adapter = (target.make as () => ProviderAdapter)();
          const chunks = await collect(
            adapter.complete([{ role: "user", content: "Say hello in three words." }], [], {
              model: target.model,
              maxTokens: 64,
              signal: new AbortController().signal,
            } as never),
          );

          // The contract every adapter promises, and the one that breaks when a
          // provider changes its stream: text, then exactly one terminator.
          expect(textOf(chunks).length).toBeGreaterThan(0);
          expect(chunks.filter((c) => c.type === "done")).toHaveLength(1);
          expect(chunks.at(-1)?.type).toBe("done");
        },
        timeout,
      );

      it(
        "asks for a tool when one would answer the question",
        async () => {
          const adapter = (target.make as () => ProviderAdapter)();
          if (!adapter.capabilities(target.model).supportsTools) {
            // A model without tool support is a fact about the model, not drift.
            return;
          }

          const chunks = await collect(
            adapter.complete(
              [{ role: "user", content: "What does our pricing note say? Look it up." }],
              [LOOKUP],
              {
                model: target.model,
                maxTokens: 256,
                signal: new AbortController().signal,
              } as never,
            ),
          );

          const calls = chunks.filter((c) => c.type === "tool_call");
          expect(calls.length).toBeGreaterThan(0);
          // The id and the name are what the loop matches results back on. A
          // provider that stopped sending either would break every tool call.
          for (const chunk of calls) {
            const { call } = chunk as { call: { id: string; name: string } };
            expect(call.id.length).toBeGreaterThan(0);
            expect(call.name).toBe("brain_search");
          }
        },
        timeout,
      );

      it(
        "maps a credential that cannot work onto a code the office knows",
        async () => {
          // The one an owner meets most: a key that was revoked, a typo, or
          // Ollama not running. If the mapping drifts they get a stack trace
          // instead of a sentence telling them what to do.
          const adapter = (target.broken as () => ProviderAdapter)();
          await expect(
            collect(
              adapter.complete([{ role: "user", content: "hello" }], [], {
                model: target.model,
                maxTokens: 16,
                signal: new AbortController().signal,
              } as never),
            ),
          ).rejects.toThrow(RunError);
        },
        timeout,
      );
    });
  }
});

describe.skipIf(LIVE)("the live suite", () => {
  it("is skipped unless it is asked for", () => {
    // So `pnpm test` on a laptop never spends money or waits on a network, and
    // so this file is visibly doing nothing rather than silently doing nothing.
    expect(LIVE).toBe(false);
  });
});
