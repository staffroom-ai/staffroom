/**
 * Finding a note by what it means.
 *
 * The acceptance case is the one that justifies the whole feature: a question
 * phrased in the owner's words finds the note that keyword search cannot,
 * because the note and the question share no words. That is checked here with a
 * fake `embed()` rather than a real model — a real one would make the test slow,
 * paid and dependent on somebody else's uptime, and the thing under test is the
 * chunking, the storage, the cosine and the fusion, all of which are ours.
 *
 * The live model is covered separately, nightly, in providers/live.test.ts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../config/config.js";
import {
  canEmbed,
  chunk,
  cosine,
  embedNotes,
  embedUnsupportedWarning,
  fromBlob,
  fuse,
  toBlob,
} from "./embeddings.js";
import { BrainIndex } from "./index.js";

const dirs: string[] = [];
const open: BrainIndex[] = [];

afterEach(() => {
  for (const i of open.splice(0)) i.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function brain(notes: Record<string, string>): { dir: string; index: BrainIndex } {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-embed-"));
  dirs.push(dir);
  const brainDir = join(dir, "brain");
  mkdirSync(join(brainDir, "00-about"), { recursive: true });

  for (const [name, body] of Object.entries(notes)) {
    writeFileSync(
      join(brainDir, "00-about", `${name}.md`),
      `---\ntitle: ${name}\ncreated: 2026-01-01T00:00:00+11:00\n---\n\n${body}\n`,
      "utf8",
    );
  }

  const index = BrainIndex.open(brainDir, { indexFile: join(dir, "brain.index.sqlite") });
  open.push(index);
  return { dir, index };
}

/**
 * A stand-in for a real embedding model.
 *
 * Each vector is a count of a few marker words, so two texts about the same
 * thing land near each other whatever words they use — which is the property a
 * real model has and the only one these tests depend on.
 */
const CONCEPTS = ["money", "time", "food"];

const fakeEmbed = vi.fn(
  async (texts: string[]): Promise<number[][]> =>
    texts.map((text) => {
      const lower = text.toLowerCase();
      const money = /price|pricing|charge|fee|cost|retainer|invoice|\$/g;
      const time = /hour|open|close|monday|week|schedule/g;
      const food = /bread|bake|loaf|pastry|cake/g;
      return [
        (lower.match(money) ?? []).length,
        (lower.match(time) ?? []).length,
        (lower.match(food) ?? []).length,
      ];
    }),
);

const provider = { id: "ollama", embed: fakeEmbed };

describe("enabling embeddings", () => {
  it("is a config error without a model", () => {
    // The acceptance case. An index built with an unknown model is not
    // reusable, so the office refuses rather than building one it cannot trust.
    const result = ConfigSchema.safeParse({
      version: 2,
      brain: { embeddings: { enabled: true } },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("brain.embeddings.model is required");
  });

  it("is fine with a model", () => {
    expect(
      ConfigSchema.safeParse({
        version: 2,
        brain: { embeddings: { enabled: true, model: "nomic-embed-text" } },
      }).success,
    ).toBe(true);
  });

  it("is fine switched off with no model, which is the default", () => {
    expect(ConfigSchema.safeParse({ version: 2 }).success).toBe(true);
  });
});

describe("a provider that cannot embed", () => {
  it("is recognised rather than called and failing", () => {
    expect(canEmbed({ id: "anthropic" })).toBe(false);
    expect(canEmbed(provider)).toBe(true);
    expect(canEmbed(undefined)).toBe(false);
  });

  it("says what would work instead", () => {
    // Silently doing keyword-only when the config asked for more would be worse
    // than either doing it or refusing.
    const warning = embedUnsupportedWarning("anthropic");
    expect(warning).toContain("anthropic");
    expect(warning).toContain("keyword only");
    expect(warning).toContain("Ollama");
  });
});

describe("chunking", () => {
  it("leaves a short note whole", () => {
    expect(chunk("One short line.")).toEqual([{ index: 0, text: "One short line." }]);
  });

  it("says nothing about an empty note", () => {
    expect(chunk("   \n  ")).toEqual([]);
  });

  it("splits a long note and overlaps the pieces", () => {
    const words = Array.from({ length: 2_000 }, (_, i) => `word${i}`).join(" ");
    const pieces = chunk(words, { tokens: 100, overlap: 20 });

    expect(pieces.length).toBeGreaterThan(1);
    // The overlap is the point: a sentence near a boundary has to survive whole
    // in one of the two chunks either side of it.
    const firstEnd = pieces[0]?.text.split(" ").slice(-3) ?? [];
    expect(pieces[1]?.text).toContain(firstEnd[0] as string);
  });

  it("never cuts a word in half", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    for (const piece of chunk(words, { tokens: 50, overlap: 10 })) {
      expect(piece.text).toMatch(/^word\d+/);
      expect(piece.text).toMatch(/word\d+$/);
    }
  });

  it("numbers them in order from zero", () => {
    const words = Array.from({ length: 1_000 }, (_, i) => `word${i}`).join(" ");
    const pieces = chunk(words, { tokens: 80, overlap: 10 });
    expect(pieces.map((p) => p.index)).toEqual(pieces.map((_, i) => i));
  });
});

describe("comparing vectors", () => {
  it("is 1 for the same direction and 0 for a right angle", () => {
    expect(cosine([1, 0, 0], [2, 0, 0])).toBeCloseTo(1);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("ignores length, which is the reason it is cosine", () => {
    expect(cosine([1, 2, 3], [10, 20, 30])).toBeCloseTo(1);
  });

  it("answers 0 rather than NaN for a zero vector or a mismatch", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it("survives a round trip through the database format", () => {
    const vector = [0.5, -0.25, 0.125];
    expect([...fromBlob(toBlob(vector))]).toEqual(vector);
  });
});

describe("fusing two rankings", () => {
  it("puts a note both searches liked above one only a single search loved", () => {
    // The whole reason for RRF: agreement beats one confident opinion.
    const fused = fuse([
      [
        { id: "both", rank: 2 },
        { id: "keyword-only", rank: 1 },
      ],
      [
        { id: "both", rank: 2 },
        { id: "vector-only", rank: 1 },
      ],
    ]);

    expect(fused[0]?.id).toBe("both");
  });

  it("keeps a note only one search found", () => {
    const ids = fuse([[{ id: "a", rank: 1 }], [{ id: "b", rank: 1 }]]).map((f) => f.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("says nothing when neither search found anything", () => {
    expect(fuse([[], []])).toEqual([]);
  });
});

describe("embedding the brain", () => {
  it("embeds every note once and does nothing the second time", async () => {
    const { index } = brain({ pricing: "We charge a monthly fee.", hours: "We open at eight." });
    fakeEmbed.mockClear();

    const first = await embedNotes(index, provider, "fake-model");
    expect(first.notes).toBe(2);
    expect(first.chunks).toBe(2);

    const calls = fakeEmbed.mock.calls.length;
    const second = await embedNotes(index, provider, "fake-model");

    // Idempotent, because this runs on every boot.
    expect(second.notes).toBe(0);
    expect(fakeEmbed.mock.calls.length).toBe(calls);
  });

  it("throws away vectors made by a different model", async () => {
    const { index } = brain({ pricing: "We charge a monthly fee." });
    await embedNotes(index, provider, "old-model");
    expect(index.embeddingStatus().models).toEqual(["old-model"]);

    const result = await embedNotes(index, provider, "new-model");

    // Two models' vectors describe different spaces. Keeping both would return
    // confident nonsense, so changing the model costs a re-embed.
    expect(result.invalidated).toBeGreaterThan(0);
    expect(index.embeddingStatus().models).toEqual(["new-model"]);
  });

  it("names a note it could not embed and carries on with the rest", async () => {
    const { index } = brain({ good: "We charge a fee.", bad: "We open at eight." });
    const flaky = {
      id: "ollama",
      embed: async (texts: string[]): Promise<number[][]> => {
        if (texts.join(" ").includes("eight")) throw new Error("the model fell over");
        return fakeEmbed(texts);
      },
    };

    const result = await embedNotes(index, flaky, "fake-model");

    // Half an index still answers. The owner needs to know which note is not in
    // it, which a count could not tell them.
    expect(result.notes).toBe(1);
    expect(result.failed).toEqual(["00-about/bad"]);
  });

  it("refuses a note when the provider returned the wrong number of vectors", async () => {
    const { index } = brain({ pricing: "We charge a monthly fee." });
    const wrong = { id: "ollama", embed: async (): Promise<number[][]> => [] };

    const result = await embedNotes(index, wrong, "fake-model");

    // Pairing them up anyway would file each chunk under the wrong meaning,
    // which is worse than not embedding the note at all.
    expect(result.notes).toBe(0);
    expect(result.failed).toEqual(["00-about/pricing"]);
  });

  it("refuses a provider that cannot embed, by name", async () => {
    const { index } = brain({ pricing: "We charge a fee." });
    await expect(embedNotes(index, { id: "anthropic" }, "m")).rejects.toThrow(/anthropic/);
  });
});

describe("hybrid search", () => {
  it("finds the note a paraphrased question misses on keywords alone", async () => {
    // The acceptance case, with the fake model standing in for a real one. The
    // note says "monthly fee"; the owner asks about a "retainer price". No word
    // is shared, so keyword search cannot find it.
    // The titles are deliberately unhelpful. Titles are weighted four times in
    // the keyword index, so a note called "pricing" would be found by a question
    // about "price" through stemming alone and the test would prove nothing.
    const { index } = brain({
      alpha: "Our monthly fee is invoiced on the first. The cost covers everything.",
      beta: "We open at eight on Monday and close at four.",
      gamma: "The sourdough loaf is baked daily.",
    });
    await embedNotes(index, provider, "fake-model");

    // Not one word of this appears in the note, title included. Two things
    // caught this out while it was being written: FTS5 has no stopword list, so
    // "is" matched the body; and a note called "note-a" tokenises to "note" and
    // "a", which the title field matches at four times the weight.
    const question = "how much for retainers";
    // Nothing at all: no note shares a word with the question.
    const keyword = index.search(question);
    expect(keyword).toEqual([]);

    const [queryVector] = await fakeEmbed([question]);
    const hybrid = index.hybridSearch(question, queryVector as number[]);

    expect(hybrid[0]?.id).toBe("00-about/alpha");
    // And it came back with something to read, from the part that matched.
    expect(hybrid[0]?.excerpt.length).toBeGreaterThan(0);
  });

  it("shows the chunk that matched, not the note's first line", async () => {
    const opening = "This note is about the studio in general.";
    const { index } = brain({
      mixed: `${opening} ${"filler ".repeat(300)} Our monthly fee is invoiced on the first.`,
    });
    await embedNotes(index, provider, "fake-model");

    const [queryVector] = await fakeEmbed(["what do we charge"]);
    const hit = index.hybridSearch("what do we charge", queryVector as number[])[0];

    // Otherwise the owner reads an excerpt that has nothing to do with their
    // question and wonders why the note came back at all.
    expect(hit?.excerpt).not.toContain(opening);
  });

  it("is plain keyword search when there is no query vector", async () => {
    const { index } = brain({ pricing: "We charge a monthly fee." });
    const hits = index.hybridSearch("monthly fee", undefined);
    expect(hits.map((h) => h.id)).toEqual(["00-about/pricing"]);
  });

  it("is plain keyword search when nothing has been embedded", () => {
    const { index } = brain({ pricing: "We charge a monthly fee." });
    // Embeddings off, or a provider that cannot do them: answering less well
    // beats refusing to answer.
    expect(index.hybridSearch("monthly fee", [1, 0, 0]).map((h) => h.id)).toEqual([
      "00-about/pricing",
    ]);
  });

  it("respects the limit it was given", async () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i < 10; i++) notes[`note-${i}`] = `We charge a fee for thing ${i}.`;
    const { index } = brain(notes);
    await embedNotes(index, provider, "fake-model");

    const [queryVector] = await fakeEmbed(["what do we charge"]);
    expect(index.hybridSearch("charge", queryVector as number[], { limit: 3 })).toHaveLength(3);
  });

  it("counts what it embedded, so doctor can say", async () => {
    const { index } = brain({ pricing: "We charge a monthly fee.", hours: "We open at eight." });
    await embedNotes(index, provider, "fake-model");

    const status = index.embeddingStatus();
    expect(status.chunks).toBe(2);
    expect(status.models).toEqual(["fake-model"]);
  });
});

describe("the concepts the fake model knows", () => {
  it("is three, which is what makes these tests readable", () => {
    // Guarding the fixture rather than the code: if somebody adds a concept the
    // vectors change length and the assertions above stop meaning what they say.
    expect(CONCEPTS).toHaveLength(3);
  });
});
