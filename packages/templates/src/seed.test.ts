/**
 * The office a first-time visitor actually opens.
 *
 * SR-060's acceptance asks for a graph with real `readBy` on the notes the demo
 * read. That needs the template to ship a run that already happened, which is
 * what `sample-run.json` is. These run against the shipped content rather than a
 * fixture, because the point is what somebody sees on their first `npx
 * staffroom` — and sample content is exactly the kind of thing that rots
 * quietly, since nobody rereads it once it is written.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainIndex, buildGraph, createOffice, readSampleRun } from "@staffroom/core";
import { afterEach, describe, expect, it } from "vitest";
import { copyTemplate, templateDir } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-seed-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  return dir;
}

function studioBrain(): BrainIndex {
  return BrainIndex.open(join(templateDir("studio"), "brain"), {
    indexFile: join(mkdtempSync(join(tmpdir(), "staffroom-seed-idx-")), "brain.index.sqlite"),
  });
}

describe("the shipped sample run", () => {
  it("is copied into the office, out of the owner's way", () => {
    const dir = office();
    expect(readSampleRun(dir)?.run.id).toBe("sample-autumn-offer");
  });

  it("names only notes this template actually ships", () => {
    // A seed pointing at notes that are not there would put holes in the very
    // graph it exists to fill.
    const seed = readSampleRun(office());
    const ids = new Set(
      studioBrain()
        .records()
        .map((r) => r.id),
    );

    const named: string[] = [];
    for (const event of seed?.events ?? []) {
      if (event.type === "tool_result" && event.noteIds !== undefined) named.push(...event.noteIds);
      if (event.type === "brain_note_written") named.push(event.noteId);
      if (event.type === "brain_pinned_included") named.push(...event.noteIds);
    }

    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(ids).toContain(id);
  });
});

describe("a brand new office", () => {
  it("has the run in its log, marked as sample", async () => {
    const dir = office();
    const built = await createOffice({ officeDir: dir });

    const runs = await built.store.list({ limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.sample).toBe(true);
    expect(runs[0]?.agentId).toBe("copywriter");
    built.close();
  });

  it("opens a graph where somebody has read something", async () => {
    const dir = office();
    const built = await createOffice({ officeDir: dir });

    const graph = await buildGraph(built.brain, built.store);
    const read = graph.nodes.filter((n) => n.readBy.length > 0);
    const written = graph.nodes.filter((n) => n.wroteBy !== undefined);

    // The whole point of the seed: the first graph an owner sees has arrows in
    // it, rather than being a filing cabinet nobody has opened.
    expect(read.length).toBeGreaterThan(0);
    expect(written.length).toBeGreaterThan(0);
    expect(graph.edges.filter((e) => e.kind === "revises")).toHaveLength(1);
    built.close();
  });

  it("dates the work when it happened, not when the office first opened", async () => {
    const dir = office();
    const built = await createOffice({ officeDir: dir });
    const run = (await built.store.list({ limit: 1 }))[0];

    // The note is dated March 2026 in its own front matter. A card saying it was
    // filed a moment ago would be a small lie about when work happened, and the
    // office is not allowed those.
    expect(new Date(run?.createdAt ?? 0).getUTCFullYear()).toBe(2026);
    expect(run?.finishedAt ?? 0).toBeLessThan(Date.now() - 1000);
    built.close();
  });

  it("does not add to an office that already has a past of its own", async () => {
    const dir = office();
    const first = await createOffice({ officeDir: dir });
    first.close();

    const second = await createOffice({ officeDir: dir });
    const runs = await second.store.list({ limit: 10 });

    // Opening twice must not seed twice, and an office with real work in it is
    // never one the template gets to add history to.
    expect(runs).toHaveLength(1);
    second.close();
  });
});
