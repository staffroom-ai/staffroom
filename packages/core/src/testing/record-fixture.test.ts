import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompletionChunk, ProviderAdapter } from "../providers/types.js";
import { ProviderError } from "../runtime/errors.js";
import { FixtureAdapter } from "./fixture-adapter.js";
import { recordFixture, redactForFixture } from "./record-fixture.js";

const dir = () => mkdtempSync(join(tmpdir(), "staffroom-record-"));
const signal = () => new AbortController().signal;

function fakeAdapter(chunks: CompletionChunk[], throws?: ProviderError): ProviderAdapter {
  return {
    id: "fake",
    kind: "openai",
    defaultModel: () => "fake-1",
    capabilities: () => ({
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsForcedTool: true,
      maxContextTokens: 8192,
    }),
    complete: async function* () {
      if (throws) throw throws;
      for (const c of chunks) yield c;
    },
    countTokens: () => Promise.resolve(0),
    pricing: () => null,
    listModels: () => Promise.resolve([{ id: "fake-1" }]),
  };
}

describe("redactForFixture", () => {
  it("replaces an sk- key", () => {
    expect(redactForFixture("auth sk-proj-abcdefghij1234567890 ok")).toBe(
      "auth sk-test-REDACTED ok",
    );
  });

  it("replaces a Bearer token", () => {
    expect(redactForFixture("Bearer abcdefghij1234567890")).toBe("Bearer REDACTED");
  });

  it("leaves ordinary text alone", () => {
    expect(redactForFixture("the day rate is 1200 AUD")).toBe("the day rate is 1200 AUD");
  });
});

describe("recordFixture", () => {
  it("writes a replayable file", async () => {
    const out = dir();
    const chunks: CompletionChunk[] = [
      { type: "text", text: "Hello" },
      { type: "done", stopReason: "end", usage: { inputTokens: 5, outputTokens: 1 } },
    ];
    await recordFixture(
      fakeAdapter(chunks),
      [{ role: "user", content: "Say hello." }],
      [],
      { model: "fake-1", maxTokens: 100, signal: signal() },
      { dir: out, name: "plain-text" },
    );

    // The proof that it round-trips: replay the file we just wrote.
    const replay = new FixtureAdapter(out, { delayMs: 0 });
    const got: CompletionChunk[] = [];
    for await (const c of replay.complete([{ role: "user", content: "Say hello." }], [], {
      model: "fake-1",
      maxTokens: 100,
      signal: signal(),
    })) {
      got.push(c);
    }
    expect(got).toEqual(chunks);
  });

  it("redacts a secret that appears in the response", async () => {
    const out = dir();
    await recordFixture(
      fakeAdapter([
        { type: "text", text: "your key is sk-proj-abcdefghij1234567890" },
        { type: "done", stopReason: "end", usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
      [{ role: "user", content: "echo the key" }],
      [],
      { model: "fake-1", maxTokens: 100, signal: signal() },
      { dir: out, name: "leaky" },
    );
    const written = readFileSync(join(out, "leaky.jsonl"), "utf8");
    expect(written).not.toContain("sk-proj-abcdefghij");
    expect(written).toContain("sk-test-REDACTED");
  });

  it("records a provider error as a replayable __error line", async () => {
    const out = dir();
    await recordFixture(
      fakeAdapter(
        [],
        new ProviderError("RATE_LIMITED", { provider: "Fake" }, { retryAfterMs: 2000 }),
      ),
      [{ role: "user", content: "too many" }],
      [],
      { model: "fake-1", maxTokens: 100, signal: signal() },
      { dir: out, name: "generic" },
    );
    expect(readFileSync(join(out, "generic.jsonl"), "utf8")).toContain('"__error"');

    const replay = new FixtureAdapter(out, { delayMs: 0 });
    await expect(async () => {
      for await (const _ of replay.complete([{ role: "user", content: "x" }], [], {
        model: "fake-1",
        maxTokens: 10,
        signal: signal(),
      })) {
        // drain
      }
    }).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 2000 });
  });

  it("rethrows an error that is not a RunError", async () => {
    const boom = Object.assign(new ProviderError("INTERNAL"), {});
    const adapter = fakeAdapter([]);
    // biome-ignore lint/correctness/useYield: a generator that only ever throws has nothing to yield.
    adapter.complete = async function* () {
      throw new TypeError("not a RunError");
    };
    await expect(
      recordFixture(
        adapter,
        [{ role: "user", content: "x" }],
        [],
        { model: "fake-1", maxTokens: 10, signal: signal() },
        { dir: dir(), name: "boom" },
      ),
    ).rejects.toThrow(TypeError);
    expect(boom.code).toBe("INTERNAL");
  });
});
