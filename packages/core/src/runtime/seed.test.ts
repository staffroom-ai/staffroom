/**
 * The run a template can ship, and every way it must not misfire.
 *
 * The office is allowed to write one run it did not do, once, into an empty log,
 * so a new office is not an empty room. Every rule below exists because the
 * alternative is the office inventing history — either adding to a log that
 * already has real work in it, or refusing to open because a piece of sample
 * content would not parse.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunStore } from "./events.js";
import { readSampleRun, sampleRunPath, seedSampleRun } from "./seed.js";
import { SqliteRunStore } from "./store.js";

const dirs: string[] = [];
const stores: RunStore[] = [];

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function office(seed?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-seed-"));
  dirs.push(dir);
  if (seed !== undefined) {
    const path = sampleRunPath(dir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof seed === "string" ? seed : JSON.stringify(seed), "utf8");
  }
  return dir;
}

function store(dir: string): RunStore {
  const made = new SqliteRunStore(join(dir, "runs.sqlite"));
  stores.push(made);
  return made;
}

const RUN = {
  id: "sample-1",
  kind: "task",
  agentId: "copywriter",
  department: "marketing",
  model: { provider: "demo", model: "demo" },
  prompt: "Write something.",
  parentRunId: null,
  routineId: null,
  createdAt: "2026-03-02T15:18:00+11:00",
};

const GOOD = {
  run: RUN,
  events: [
    { type: "brain_note_written", noteId: "40-deliverables/marketing/a", status: "draft" },
    {
      type: "done",
      deliverable: { title: "A", text: "# A\n", noteId: "40-deliverables/marketing/a" },
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: null,
      toolsUsed: [],
      turns: 1,
    },
  ],
};

describe("reading the seed", () => {
  it("reads one that is there", () => {
    expect(readSampleRun(office(GOOD))?.run.id).toBe("sample-1");
  });

  it("is undefined when a template did not ship one", () => {
    expect(readSampleRun(office())).toBeUndefined();
  });

  it("is undefined rather than throwing on a file that will not parse", () => {
    expect(readSampleRun(office("{ not json"))).toBeUndefined();
  });

  it("is undefined for a file that parses but is not a run", () => {
    expect(readSampleRun(office({ hello: "world" }))).toBeUndefined();
    expect(readSampleRun(office({ run: { id: 7 }, events: [] }))).toBeUndefined();
    expect(readSampleRun(office({ run: RUN, events: "not an array" }))).toBeUndefined();
  });
});

describe("writing it into the log", () => {
  it("writes the run and its events", async () => {
    const dir = office(GOOD);
    const log = store(dir);

    expect(await seedSampleRun(dir, log)).toBe("sample-1");
    expect(await log.list({ limit: 10 })).toHaveLength(1);
  });

  it("marks it as sample, so it can be cleared when the owner goes live", async () => {
    const dir = office(GOOD);
    const log = store(dir);
    await seedSampleRun(dir, log);

    expect((await log.list({ limit: 1 }))[0]?.sample).toBe(true);
  });

  it("marks it sample even if the file claims otherwise", async () => {
    // Sample content does not get to describe itself as the owner's own work.
    const dir = office({ ...GOOD, run: { ...RUN, sample: false } });
    const log = store(dir);
    await seedSampleRun(dir, log);

    expect((await log.list({ limit: 1 }))[0]?.sample).toBe(true);
  });

  it("dates it when it happened, not when the office opened", async () => {
    const dir = office(GOOD);
    const log = store(dir);
    await seedSampleRun(dir, log);

    const run = (await log.list({ limit: 1 }))[0];
    expect(new Date(run?.createdAt ?? 0).getUTCFullYear()).toBe(2026);
    expect(run?.createdAt).toBeLessThan(Date.now() - 1_000);
  });

  it("falls back to now when the date in the file is nonsense", async () => {
    const dir = office({ ...GOOD, run: { ...RUN, createdAt: "not a date" } });
    const log = store(dir);
    await seedSampleRun(dir, log);

    const run = (await log.list({ limit: 1 }))[0];
    expect(run?.createdAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it("takes a timestamp already in milliseconds", async () => {
    const dir = office({ ...GOOD, run: { ...RUN, createdAt: 1_700_000_000_000 } });
    const log = store(dir);
    await seedSampleRun(dir, log);

    expect((await log.list({ limit: 1 }))[0]?.createdAt).toBe(1_700_000_000_000);
  });

  it("does nothing at all when there is no seed to write", async () => {
    const dir = office();
    const log = store(dir);

    expect(await seedSampleRun(dir, log)).toBeUndefined();
    expect(await log.list({ limit: 10 })).toHaveLength(0);
  });

  it("never adds to a log that already has a run in it", async () => {
    const dir = office(GOOD);
    const log = store(dir);
    await log.create({
      id: "real-work",
      kind: "task",
      agentId: "copywriter",
      department: "marketing",
      model: { provider: "demo", model: "demo" },
      prompt: "Something the owner actually asked for.",
      parentRunId: null,
      routineId: null,
      sample: false,
      createdAt: Date.now(),
    });

    // An office with a past of its own is not one the template gets to add to.
    expect(await seedSampleRun(dir, log)).toBeUndefined();
    expect(await log.list({ limit: 10 })).toHaveLength(1);
  });

  it("does not write twice when the office is opened twice", async () => {
    const dir = office(GOOD);
    const log = store(dir);

    await seedSampleRun(dir, log);
    expect(await seedSampleRun(dir, log)).toBeUndefined();
    expect(await log.list({ limit: 10 })).toHaveLength(1);
  });

  it("gives up quietly rather than failing to open the office", async () => {
    const dir = office(GOOD);
    const broken: RunStore = {
      ...store(dir),
      list: async () => {
        throw new Error("the log is unreadable");
      },
    };

    // Sample content is worth having and never worth refusing to open over.
    expect(await seedSampleRun(dir, broken)).toBeUndefined();
  });
});
