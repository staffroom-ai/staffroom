/**
 * What the graph looks like in the office a first-time visitor actually opens.
 *
 * SR-060's acceptance is about the shipped studio content, not a fixture, so it
 * runs here where the templates live. A template that points at notes it does
 * not ship, or that lost its revision chain to an edit, would be a broken first
 * impression — and the kind that rots quietly, because nobody rereads sample
 * content once it is written.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainIndex, brainRevisions, buildGraph, SqliteRunStore } from "@staffroom/core";
import { describe, expect, it } from "vitest";
import { templateDir } from "./index.js";

function studio(): BrainIndex {
  return BrainIndex.open(join(templateDir("studio"), "brain"), {
    indexFile: join(mkdtempSync(join(tmpdir(), "staffroom-tpl-idx-")), "brain.index.sqlite"),
  });
}

/**
 * No runs.sqlite ships with the template, so the graph opens without `readBy`
 * or `wroteBy`. That is a gap in the sample content rather than in the graph:
 * `brain.md` says the template should ship a sample run, and it does not yet.
 */
function noRuns(): SqliteRunStore {
  return new SqliteRunStore(
    join(mkdtempSync(join(tmpdir(), "staffroom-tpl-runs-")), "runs.sqlite"),
  );
}

describe("the studio brain", () => {
  it("opens with a revision chain, which is what a demo is meant to show", async () => {
    const graph = await buildGraph(studio(), noRuns());
    const revisions = graph.edges.filter((e) => e.kind === "revises");

    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.from).toBe("40-deliverables/marketing/2026-03-02-autumn-offer-email");
    expect(revisions[0]?.to).toBe("40-deliverables/marketing/2026-03-01-autumn-offer-email");
  });

  it("has both ends of that chain as real notes", async () => {
    const chain = brainRevisions(
      studio(),
      "40-deliverables/marketing/2026-03-02-autumn-offer-email",
    );

    expect(chain.map((r) => r.id)).toEqual([
      "40-deliverables/marketing/2026-03-01-autumn-offer-email",
      "40-deliverables/marketing/2026-03-02-autumn-offer-email",
    ]);
  });

  it("links up, and nothing in it dangles", async () => {
    const graph = await buildGraph(studio(), noRuns());

    expect(graph.edges.filter((e) => e.kind === "link").length).toBeGreaterThan(0);
    expect(graph.nodes.filter((n) => n.kind === "missing")).toEqual([]);
  });

  it("shows its deliverables as deliverables, not as sample background", async () => {
    const graph = await buildGraph(studio(), noRuns());
    const deliverables = graph.nodes.filter((n) => n.kind === "deliverable");

    expect(deliverables.length).toBeGreaterThan(0);
    expect(deliverables.every((n) => n.id.startsWith("40-deliverables/"))).toBe(true);
  });

  it("pins the notes every agent is meant to start from", async () => {
    const graph = await buildGraph(studio(), noRuns());
    const pinned = graph.nodes.filter((n) => n.pinned).map((n) => n.id);

    // The four notes in 00-about that every agent starts from. Named here so a
    // renamed or un-pinned file shows up as a failure rather than as agents
    // quietly losing the context that makes them sound like this business.
    expect(pinned.sort()).toEqual([
      "00-about/company",
      "00-about/how-we-work",
      "00-about/pricing",
      "00-about/voice",
    ]);
  });
});
