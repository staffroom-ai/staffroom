/**
 * Getting Northlight Studio out of somebody's office.
 *
 * Two acceptance cases run this: after yes, `brain_search` stops returning the
 * template's notes and "Latest results" is empty; and the question is not asked
 * on the next boot. Both are here, against a real studio office on disk and a
 * real index, because the interesting failures are all about files.
 *
 * The rest is the promise around the answer: nothing the owner wrote moves,
 * nothing is deleted from disk, and `approvals.yaml` is not touched.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BrainIndex, type RunStore, SqliteRunStore } from "@staffroom/core";
import { copyTemplate } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSampleAnswer,
  readSchedulerState,
  recordSampleAnswer,
  writeSchedulerState,
} from "../scheduler/scheduler.js";
import {
  findSampleNotes,
  leaveDemo,
  SAMPLE_DIR,
  sampleQuestion,
  shouldAskAboutSamples,
} from "./leave.js";

const dirs: string[] = [];
const stores: RunStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-leave-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  return dir;
}

const brainOf = (officeDir: string): string => join(officeDir, "brain");

function store(officeDir: string): RunStore {
  const made = new SqliteRunStore(join(officeDir, "runs.sqlite"), { chunkFlushMs: 0 });
  stores.push(made);
  return made;
}

function index(officeDir: string): BrainIndex {
  const opened = BrainIndex.open(brainOf(officeDir), {
    indexFile: join(officeDir, "brain.index.sqlite"),
  });
  return opened;
}

/** A note the owner wrote themselves: no `sample` flag anywhere. */
function ownNote(officeDir: string, rel: string, body: string): void {
  const path = join(brainOf(officeDir), rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `---\ntitle: Mine\ncreated: 2026-01-01T00:00:00+11:00\npinned: true\n---\n\n${body}\n`,
    "utf8",
  );
}

/**
 * A run that has actually finished, because that is the only kind "Latest
 * results" shows. Creating one and leaving it queued would test a list nobody
 * looks at.
 */
async function finishedRun(runs: RunStore, id: string, sample: boolean): Promise<void> {
  const run = await runs.create({
    id,
    kind: "task",
    agentId: "copywriter",
    department: "marketing",
    model: { provider: sample ? "demo" : "anthropic", model: "demo" },
    prompt: "Write the autumn offer email",
    parentRunId: null,
    routineId: null,
    sample,
    createdAt: Date.parse("2026-03-02T09:00:00Z"),
  } as Parameters<RunStore["create"]>[0]);

  await runs.append(run.id, {
    type: "done",
    deliverable: { title: "Autumn offer email", text: "# Autumn offer email\n", noteId: null },
    usage: { inputTokens: 10, outputTokens: 10 },
    costUsd: null,
    toolsUsed: [],
    turns: 1,
  } as Parameters<RunStore["append"]>[1]);
}

async function sampleRun(runs: RunStore, id: string): Promise<void> {
  await finishedRun(runs, id, true);
}

describe("the question", () => {
  it("names the business, because that is what makes it answerable", () => {
    expect(sampleQuestion("Northlight Studio")).toBe(
      "Remove the sample notes and runs from Northlight Studio? Your own notes are kept. (Recommended)",
    );
  });

  it("is asked in a live office that still has the template's notes", () => {
    const officeDir = office();
    expect(
      shouldAskAboutSamples({ mode: "live", answered: false, brainDir: brainOf(officeDir) }),
    ).toBe(true);
  });

  it("is not asked in demo mode", () => {
    // The sample office is the only thing there is to look at in demo mode, so
    // offering to clear it out would be offering to empty the screen.
    const officeDir = office();
    expect(
      shouldAskAboutSamples({ mode: "demo", answered: false, brainDir: brainOf(officeDir) }),
    ).toBe(false);
  });

  it("is not asked again once it has been answered", () => {
    const officeDir = office();
    expect(
      shouldAskAboutSamples({ mode: "live", answered: true, brainDir: brainOf(officeDir) }),
    ).toBe(false);
  });

  it("is not asked when there is no sample content to ask about", () => {
    const officeDir = office();
    for (const note of findSampleNotes(brainOf(officeDir))) rmSync(note.path);
    expect(
      shouldAskAboutSamples({ mode: "live", answered: false, brainDir: brainOf(officeDir) }),
    ).toBe(false);
  });
});

describe("finding what came with the template", () => {
  it("finds the studio's notes", () => {
    const found = findSampleNotes(brainOf(office()));
    expect(found.length).toBeGreaterThan(10);
    expect(found.map((f) => f.rel)).toContain("00-about/company.md");
  });

  it("finds the ones inside _private too", () => {
    // Never indexed, so never searched — but still somebody else's fake logins
    // sitting in a folder called private. Leaving them would be odd to explain.
    expect(findSampleNotes(brainOf(office())).map((f) => f.rel)).toContain("_private/logins.md");
  });

  it("does not claim a note the owner wrote", () => {
    const officeDir = office();
    ownNote(officeDir, "10-customers/my-customer.md", "Real work.");
    expect(findSampleNotes(brainOf(officeDir)).map((f) => f.rel)).not.toContain(
      "10-customers/my-customer.md",
    );
  });

  it("answers an empty list for a folder that is not there", () => {
    expect(findSampleNotes(join(office(), "nowhere"))).toEqual([]);
  });
});

describe("after yes", () => {
  it("stops the template's notes answering a search", async () => {
    const officeDir = office();
    const before = index(officeDir);
    expect(before.search("Northlight").length).toBeGreaterThan(0);
    before.close();

    await leaveDemo({ brainDir: brainOf(officeDir), store: store(officeDir) });

    // A fresh index over the same folder: this is what the next boot reads.
    const after = index(officeDir);
    expect(after.search("Northlight")).toEqual([]);
    expect(after.search("Acme Bakery")).toEqual([]);
    after.close();
  });

  it("empties Latest results, which is what the owner actually sees", async () => {
    const officeDir = office();
    const runs = store(officeDir);
    await sampleRun(runs, "run-sample-1");
    await sampleRun(runs, "run-sample-2");
    expect((await runs.list({ status: ["done"] })).length).toBe(2);

    const result = await leaveDemo({ brainDir: brainOf(officeDir), store: runs });

    expect(result.runsDeleted).toBe(2);
    expect(await runs.list({ status: ["done"] })).toEqual([]);
  });

  it("keeps the owner's own notes, searchable and where they were", async () => {
    const officeDir = office();
    ownNote(officeDir, "10-customers/my-customer.md", "The kiln runs at 240 degrees.");

    await leaveDemo({ brainDir: brainOf(officeDir), store: store(officeDir) });

    expect(existsSync(join(brainOf(officeDir), "10-customers", "my-customer.md"))).toBe(true);
    const after = index(officeDir);
    expect(after.search("kiln").length).toBeGreaterThan(0);
    after.close();
  });

  it("moves rather than deletes, keeping the sub-path", async () => {
    const officeDir = office();
    await leaveDemo({ brainDir: brainOf(officeDir), store: store(officeDir) });

    // "Remove" means out of the way. A file somebody can still open is a much
    // kinder answer than one that is gone.
    const moved = join(brainOf(officeDir), SAMPLE_DIR, "00-about", "company.md");
    expect(existsSync(moved)).toBe(true);
    expect(readFileSync(moved, "utf8").length).toBeGreaterThan(0);
    expect(existsSync(join(brainOf(officeDir), "00-about", "company.md"))).toBe(false);
  });

  it("unpins what it moves", async () => {
    const officeDir = office();
    const pinned = findSampleNotes(brainOf(officeDir)).filter((f) =>
      /^pinned:\s*true/m.test(readFileSync(f.path, "utf8")),
    );
    expect(pinned.length).toBeGreaterThan(0);

    await leaveDemo({ brainDir: brainOf(officeDir), store: store(officeDir) });

    for (const note of pinned) {
      const moved = join(brainOf(officeDir), SAMPLE_DIR, ...note.rel.split("/"));
      expect(readFileSync(moved, "utf8")).toContain("pinned: false");
    }
  });

  it("does not touch approvals.yaml", async () => {
    const officeDir = office();
    const approvals = join(officeDir, "approvals.yaml");
    const before = existsSync(approvals) ? readFileSync(approvals, "utf8") : null;

    await leaveDemo({ brainDir: brainOf(officeDir), store: store(officeDir) });

    // A permission the owner granted is theirs. Revoking one because they
    // tidied up would be the office deciding something nobody asked about.
    const after = existsSync(approvals) ? readFileSync(approvals, "utf8") : null;
    expect(after).toBe(before);
  });

  it("reports what it did, and finds nothing left to do on a second run", async () => {
    const officeDir = office();
    const runs = store(officeDir);
    const first = await leaveDemo({ brainDir: brainOf(officeDir), store: runs });

    expect(first.notesMoved).toBeGreaterThan(10);
    expect(first.failed).toEqual([]);

    // Run twice — two tabs, or a restart mid-way. It has to be safe.
    const second = await leaveDemo({ brainDir: brainOf(officeDir), store: runs });
    expect(second.notesMoved).toBe(0);
    expect(second.failed).toEqual([]);
  });

  it("leaves the owner's own runs alone", async () => {
    const officeDir = office();
    const runs = store(officeDir);
    await sampleRun(runs, "run-sample");
    await finishedRun(runs, "run-mine", false);

    await leaveDemo({ brainDir: brainOf(officeDir), store: runs });

    expect((await runs.list({ status: ["done"] })).map((r) => r.id)).toEqual(["run-mine"]);
  });
});

describe("the recorded answer", () => {
  it("is not there until somebody answers", () => {
    expect(readSampleAnswer(office())).toBeUndefined();
  });

  it("survives to the next boot, so the question is not asked twice", () => {
    const officeDir = office();
    recordSampleAnswer(officeDir, "removed");

    expect(readSampleAnswer(officeDir)).toBe("removed");
    expect(
      shouldAskAboutSamples({
        mode: "live",
        answered: readSampleAnswer(officeDir) !== undefined,
        brainDir: brainOf(officeDir),
      }),
    ).toBe(false);
  });

  it("records a no as firmly as a yes", () => {
    // Keeping them is a choice, not a deferral. An office that asked again
    // tomorrow would be one that was not listening.
    const officeDir = office();
    recordSampleAnswer(officeDir, "kept");
    expect(readSampleAnswer(officeDir)).toBe("kept");
  });

  it("keeps the routine marks that share the file", () => {
    const officeDir = office();
    writeSchedulerState(officeDir, { lastRunAt: { "morning-summary": 1_700_000_000_000 } });

    recordSampleAnswer(officeDir, "removed");

    // Losing these would make a week of missed summaries arrive at once, which
    // is a strange price for answering a question about sample text.
    const state = readSchedulerState(officeDir);
    expect(state.lastRunAt["morning-summary"]).toBe(1_700_000_000_000);
    expect(state.sampleContent).toBe("removed");
  });

  it("ignores a value somebody typed into the file by hand", () => {
    const officeDir = office();
    mkdirSync(join(officeDir, ".staffroom"), { recursive: true });
    writeFileSync(
      join(officeDir, ".staffroom", "scheduler.json"),
      JSON.stringify({ lastRunAt: {}, sampleContent: "maybe" }),
      "utf8",
    );
    expect(readSampleAnswer(officeDir)).toBeUndefined();
  });
});
