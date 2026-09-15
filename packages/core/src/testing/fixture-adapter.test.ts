import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CompletionChunk, Message } from "../providers/types.js";
import { ProviderError } from "../runtime/errors.js";
import { FixtureAdapter, hashRequest } from "./fixture-adapter.js";

const DEMO = fileURLToPath(new URL("./fixtures/demo", import.meta.url));
const noSignal = () => new AbortController().signal;

function tempFixtures(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-fixtures-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, "utf8");
  return dir;
}

async function collect(iter: AsyncIterable<CompletionChunk>): Promise<CompletionChunk[]> {
  const out: CompletionChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe("hashRequest", () => {
  it("is stable for the same request", () => {
    const messages: Message[] = [{ role: "user", content: "hi" }];
    expect(hashRequest(messages, [], "demo")).toBe(hashRequest(messages, [], "demo"));
  });

  it("differs when the content differs", () => {
    expect(hashRequest([{ role: "user", content: "a" }], [])).not.toBe(
      hashRequest([{ role: "user", content: "b" }], []),
    );
  });

  it("differs when the model differs", () => {
    const messages: Message[] = [{ role: "user", content: "hi" }];
    expect(hashRequest(messages, [], "demo")).not.toBe(hashRequest(messages, [], "other"));
  });
});

describe("selection", () => {
  it("prefers an exact request match", () => {
    const adapter = new FixtureAdapter(DEMO, { delayMs: 0 });
    const picked = adapter.select([{ role: "user", content: "Say hello." }], [], "demo");
    expect(picked.name).toBe("plain-text");
  });

  it("falls back to keyword scoring for demo runs", () => {
    const dir = tempFixtures({
      "newsletter.jsonl":
        '{"matches":["newsletter","draft"],"delayMs":0}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
      "pricing.jsonl":
        '{"matches":["pricing"],"delayMs":0}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
    });
    const adapter = new FixtureAdapter(dir, { delayMs: 0 });
    expect(adapter.select([{ role: "user", content: "Draft the newsletter" }]).name).toBe(
      "newsletter",
    );
    expect(adapter.select([{ role: "user", content: "check our pricing" }]).name).toBe("pricing");
  });

  it("picks the highest scoring transcript, not the first match", () => {
    const dir = tempFixtures({
      "one.jsonl":
        '{"matches":["newsletter"],"delayMs":0}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
      "two.jsonl":
        '{"matches":["newsletter","october"],"delayMs":0}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
    });
    expect(
      new FixtureAdapter(dir).select([{ role: "user", content: "the october newsletter" }]).name,
    ).toBe("two");
  });

  it("falls back to generic when nothing matches", () => {
    const adapter = new FixtureAdapter(DEMO, { delayMs: 0 });
    expect(adapter.select([{ role: "user", content: "something nobody recorded" }]).name).toBe(
      "generic",
    );
  });

  it("throws a helpful error when there is no match and no generic", () => {
    const dir = tempFixtures({
      "only.jsonl":
        '{"matches":["nothing-alike"],"delayMs":0}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
    });
    const adapter = new FixtureAdapter(dir);
    expect(() => adapter.select([{ role: "user", content: "unrelated" }])).toThrow(
      /generic\.jsonl/,
    );
  });

  it("refuses a directory with no fixtures", () => {
    expect(() => new FixtureAdapter(tempFixtures({}))).toThrow(/no \.jsonl fixtures/);
  });
});

describe("playback", () => {
  it("replays chunks in order", async () => {
    const adapter = new FixtureAdapter(DEMO, { delayMs: 0 });
    const chunks = await collect(
      adapter.complete([{ role: "user", content: "Name the company." }], [], {
        model: "demo",
        maxTokens: 100,
        signal: noSignal(),
      }),
    );
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("Northlight Studio");
  });

  it("divides the delay by the speed", async () => {
    const dir = tempFixtures({
      "generic.jsonl":
        '{"matches":[],"delayMs":40}\n{"type":"text","text":"a"}\n{"type":"text","text":"b"}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
    });
    const adapter = new FixtureAdapter(dir);
    adapter.setSpeed(4);

    const started = performance.now();
    await collect(
      adapter.complete([{ role: "user", content: "x" }], [], {
        model: "demo",
        maxTokens: 10,
        signal: noSignal(),
      }),
    );
    const elapsed = performance.now() - started;

    // Three chunks at 40/4 = 10ms each is about 30ms; at speed 1 it would be 120ms.
    expect(elapsed).toBeLessThan(100);
  });

  it("throws AbortError and yields nothing when already aborted", async () => {
    const adapter = new FixtureAdapter(DEMO, { delayMs: 0 });
    const controller = new AbortController();
    controller.abort();
    const chunks: CompletionChunk[] = [];
    await expect(async () => {
      for await (const c of adapter.complete([{ role: "user", content: "Say hello." }], [], {
        model: "demo",
        maxTokens: 10,
        signal: controller.signal,
      })) {
        chunks.push(c);
      }
    }).rejects.toThrow(/abort/i);
    expect(chunks).toHaveLength(0);
  });

  it("stops mid-stream when the signal aborts, with no done", async () => {
    const dir = tempFixtures({
      "generic.jsonl":
        '{"matches":[],"delayMs":5}\n{"type":"text","text":"a"}\n{"type":"text","text":"b"}\n{"type":"text","text":"c"}\n{"type":"done","stopReason":"end","usage":{"inputTokens":1,"outputTokens":1}}\n',
    });
    const adapter = new FixtureAdapter(dir);
    const controller = new AbortController();
    const chunks: CompletionChunk[] = [];

    await expect(async () => {
      for await (const c of adapter.complete([{ role: "user", content: "x" }], [], {
        model: "demo",
        maxTokens: 10,
        signal: controller.signal,
      })) {
        chunks.push(c);
        controller.abort();
      }
    }).rejects.toThrow(/abort/i);

    expect(chunks).toHaveLength(1);
    expect(chunks.filter((c) => c.type === "done")).toHaveLength(0);
  });

  it("throws the recorded ProviderError with its retry hint", async () => {
    const adapter = new FixtureAdapter(DEMO, { delayMs: 0 });
    const run = collect(
      adapter.complete([{ role: "user", content: "Trigger a rate limit." }], [], {
        model: "demo",
        maxTokens: 10,
        signal: noSignal(),
      }),
    );
    await expect(run).rejects.toBeInstanceOf(ProviderError);
    await run.catch((error: ProviderError) => {
      expect(error.code).toBe("RATE_LIMITED");
      expect(error.retryAfterMs).toBe(1000);
      expect(error.status).toBe(429);
      expect(error.retryable).toBe(true);
    });
  });
});

describe("adapter surface", () => {
  it("reports no price, because replaying a file cost nothing", () => {
    expect(new FixtureAdapter(DEMO).pricing("demo")).toBeNull();
  });

  it("declares itself a demo adapter", () => {
    const adapter = new FixtureAdapter(DEMO);
    expect(adapter.kind).toBe("demo");
    expect(adapter.id).toBe("demo");
    expect(adapter.defaultModel()).toBe("demo");
  });

  it("claims full capabilities so fixtures can exercise every path", () => {
    const caps = new FixtureAdapter(DEMO).capabilities("demo");
    expect(caps.supportsTools).toBe(true);
    expect(caps.supportsForcedTool).toBe(true);
    expect(caps.maxContextTokens).toBeNull();
  });

  it("lists one model and counts no tokens", async () => {
    const adapter = new FixtureAdapter(DEMO);
    await expect(adapter.listModels()).resolves.toEqual([{ id: "demo" }]);
    await expect(adapter.countTokens()).resolves.toBe(0);
  });
});
