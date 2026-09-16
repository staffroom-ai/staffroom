/**
 * The brain as a picture.
 *
 * Most of what is protected here is the graph telling the truth about gaps. A
 * link to a note nobody wrote, a revision chain whose original was deleted, a
 * run log with a damaged row: in each case the honest answer is to show the hole
 * rather than a tidy picture that quietly agrees with itself, because a graph an
 * owner cannot trust to show them what is missing is worse than no graph.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunEvent, RunStore } from "../runtime/events.js";
import { SqliteRunStore } from "../runtime/store.js";
import {
  brainRevisions,
  buildGraph,
  missingId,
  noteIndexedDelta,
  noteRemovedDelta,
} from "./graph.js";
import { BrainIndex } from "./index.js";

function brain(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-graph-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return dir;
}

function open(dir: string): BrainIndex {
  return BrainIndex.open(dir, {
    indexFile: join(mkdtempSync(join(tmpdir(), "staffroom-gidx-")), "brain.index.sqlite"),
  });
}

function note(title: string, body = "Some body.", front: Record<string, unknown> = {}): string {
  const lines = [`title: ${title}`, "created: 2026-01-01T00:00:00+11:00"];
  for (const [k, v] of Object.entries(front)) lines.push(`${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

/** A run log with nothing in it: the common case for a brand new office. */
function emptyRuns(): RunStore {
  return new SqliteRunStore(join(mkdtempSync(join(tmpdir(), "staffroom-runs-")), "runs.sqlite"));
}

/** A real store with a real run in it, because the join is the point. */
async function runsWith(
  events: RunEvent[],
  agentId = "researcher",
): Promise<{ store: RunStore; runId: string }> {
  const store = new SqliteRunStore(
    join(mkdtempSync(join(tmpdir(), "staffroom-runs-")), "runs.sqlite"),
  );
  const run = await store.create({
    id: "run-1",
    kind: "task",
    agentId,
    department: "marketing",
    model: { provider: "demo", model: "demo" },
    prompt: "Write the autumn offer.",
    parentRunId: null,
    routineId: null,
    sample: false,
    createdAt: Date.now(),
  });
  for (const event of events) await store.append(run.id, event);
  store.flush();
  return { store, runId: run.id };
}

describe("nodes", () => {
  it("has one per note, with what the owner wrote about it", async () => {
    const dir = brain({
      "00-about/company.md": note("Northlight Studio", "We are a studio.", { pinned: true }),
    });
    const graph = await buildGraph(open(dir), emptyRuns());

    const company = graph.nodes.find((n) => n.id === "00-about/company");
    expect(company?.title).toBe("Northlight Studio");
    expect(company?.area).toBe("00-about");
    expect(company?.pinned).toBe(true);
    expect(company?.kind).toBe("note");
    expect(company?.wordCount).toBeGreaterThan(0);
  });

  it("calls a deliverable a deliverable, even one from a template", async () => {
    const dir = brain({
      "40-deliverables/marketing/offer.md": note("Autumn offer", "Copy.", {
        sample: true,
        status: "draft",
        department: "marketing",
      }),
      "00-about/company.md": note("Us", "About us.", { sample: true }),
    });
    const graph = await buildGraph(open(dir), emptyRuns());

    // Where it lives beats where it came from: calling this "sample" would hide
    // every piece of work in the demo office.
    expect(graph.nodes.find((n) => n.id === "40-deliverables/marketing/offer")?.kind).toBe(
      "deliverable",
    );
    expect(graph.nodes.find((n) => n.id === "00-about/company")?.kind).toBe("sample");
  });

  it("carries the status a deliverable is in", async () => {
    const dir = brain({
      "40-deliverables/marketing/offer.md": note("Offer", "Copy.", { status: "approved" }),
    });
    const graph = await buildGraph(open(dir), emptyRuns());
    expect(graph.nodes[0]?.status).toBe("approved");
  });

  it("is ordered, so two snapshots of the same brain can be compared", async () => {
    const dir = brain({
      "20-products/b.md": note("B"),
      "00-about/a.md": note("A"),
      "10-customers/c.md": note("C"),
    });
    const graph = await buildGraph(open(dir), emptyRuns());
    expect(graph.nodes.map((n) => n.id)).toEqual(["00-about/a", "10-customers/c", "20-products/b"]);
  });
});

describe("links", () => {
  it("draws an edge between two notes that link", async () => {
    const dir = brain({
      "00-about/company.md": note("Us", "We serve [[10-customers/acme]]."),
      "10-customers/acme.md": note("Acme"),
    });
    const graph = await buildGraph(open(dir), emptyRuns());

    expect(graph.edges).toContainEqual({
      from: "00-about/company",
      to: "10-customers/acme",
      kind: "link",
    });
  });

  it("shows a link to a note nobody wrote as a hole, not as nothing", async () => {
    const dir = brain({ "00-about/company.md": note("Us", "Our [[pricing]] is simple.") });
    const graph = await buildGraph(open(dir), emptyRuns());

    const missing = graph.nodes.find((n) => n.kind === "missing");
    // Named as the owner typed it, so they can see what they meant to write.
    expect(missing?.title).toBe("pricing");
    expect(graph.edges).toContainEqual({
      from: "00-about/company",
      to: missingId("pricing"),
      kind: "link",
    });
  });

  it("makes one missing node however many notes point at it", async () => {
    const dir = brain({
      "00-about/a.md": note("A", "See [[pricing]]."),
      "00-about/b.md": note("B", "Also [[pricing]]."),
    });
    const graph = await buildGraph(open(dir), emptyRuns());

    expect(graph.nodes.filter((n) => n.kind === "missing")).toHaveLength(1);
    expect(graph.edges.filter((e) => e.to === missingId("pricing"))).toHaveLength(2);
  });
});

describe("revisions", () => {
  it("is its own kind of edge, because it is history rather than a reference", async () => {
    const dir = brain({
      "40-deliverables/marketing/v1.md": note("Draft one", "First go."),
      "40-deliverables/marketing/v2.md": note("Draft two", "Second go.", {
        revises: "40-deliverables/marketing/v1",
      }),
    });
    const graph = await buildGraph(open(dir), emptyRuns());

    expect(graph.edges).toContainEqual({
      from: "40-deliverables/marketing/v2",
      to: "40-deliverables/marketing/v1",
      kind: "revises",
    });
  });

  it("returns a chain oldest first, from any note in it", async () => {
    const dir = brain({
      "40-deliverables/marketing/v1.md": note("One", "a"),
      "40-deliverables/marketing/v2.md": note("Two", "b", {
        revises: "40-deliverables/marketing/v1",
      }),
      "40-deliverables/marketing/v3.md": note("Three", "c", {
        revises: "40-deliverables/marketing/v2",
      }),
    });
    const index = open(dir);
    const ids = ["v1", "v2", "v3"].map((v) => `40-deliverables/marketing/${v}`);

    // The same chain whichever end you ask from, because "what happened to this"
    // is the same question from the first draft and the last.
    for (const id of ids) {
      expect(brainRevisions(index, id).map((r) => r.id)).toEqual(ids);
    }
  });

  it("stops rather than spinning on a chain the owner typed into a loop", async () => {
    const dir = brain({
      "40-deliverables/marketing/a.md": note("A", "a", {
        revises: "40-deliverables/marketing/b",
      }),
      "40-deliverables/marketing/b.md": note("B", "b", {
        revises: "40-deliverables/marketing/a",
      }),
    });
    const index = open(dir);
    // Front matter is the owner's to write, and nothing stops them typing this.
    expect(brainRevisions(index, "40-deliverables/marketing/a")).toHaveLength(2);
  });

  it("ignores a note that says it revises itself", async () => {
    const dir = brain({
      "40-deliverables/marketing/a.md": note("A", "a", {
        revises: "40-deliverables/marketing/a",
      }),
    });
    const graph = await buildGraph(open(dir), emptyRuns());
    expect(graph.edges.filter((e) => e.kind === "revises")).toEqual([]);
  });

  it("shows a revision whose original was deleted as revising a hole", async () => {
    const dir = brain({
      "40-deliverables/marketing/v2.md": note("Two", "b", {
        revises: "40-deliverables/marketing/v1",
      }),
    });
    const graph = await buildGraph(open(dir), emptyRuns());

    expect(graph.edges).toContainEqual({
      from: "40-deliverables/marketing/v2",
      to: missingId("40-deliverables/marketing/v1"),
      kind: "revises",
    });
  });

  it("is empty for a note nobody has", async () => {
    const dir = brain({ "00-about/a.md": note("A") });
    expect(brainRevisions(open(dir), "00-about/nope")).toEqual([]);
  });
});

describe("who read what", () => {
  const READ: RunEvent = {
    type: "tool_result",
    toolCallId: "c1",
    name: "brain_search",
    output: "[]",
    isError: false,
    durationMs: 4,
    truncated: false,
    redactedCount: 0,
    noteIds: ["00-about/company"],
  };

  it("joins reads from the run log onto the note", async () => {
    const dir = brain({ "00-about/company.md": note("Us") });
    const { store, runId } = await runsWith([READ]);

    const graph = await buildGraph(open(dir), store);
    const company = graph.nodes.find((n) => n.id === "00-about/company");

    expect(company?.readBy).toHaveLength(1);
    expect(company?.readBy[0]?.agentId).toBe("researcher");
    expect(company?.readBy[0]?.runId).toBe(runId);
  });

  it("counts brain_read as well as brain_search", async () => {
    const dir = brain({ "00-about/company.md": note("Us") });
    const { store } = await runsWith([{ ...READ, name: "brain_read", toolCallId: "c2" }]);

    const graph = await buildGraph(open(dir), store);
    expect(graph.nodes.find((n) => n.id === "00-about/company")?.readBy).toHaveLength(1);
  });

  it("ignores a tool result from a tool that is not a brain tool", async () => {
    const dir = brain({ "00-about/company.md": note("Us") });
    const { store } = await runsWith([{ ...READ, name: "web_search" }]);

    const graph = await buildGraph(open(dir), store);
    expect(graph.nodes.find((n) => n.id === "00-about/company")?.readBy).toEqual([]);
  });

  it("stops at twenty, so one busy note does not become a wall", async () => {
    const dir = brain({ "00-about/company.md": note("Us") });
    const many = Array.from({ length: 30 }, (_, i) => ({ ...READ, toolCallId: `c${i}` }));
    const { store } = await runsWith(many);

    const graph = await buildGraph(open(dir), store);
    expect(graph.nodes.find((n) => n.id === "00-about/company")?.readBy).toHaveLength(20);
  });

  it("does not invent a node for a note that was read and then deleted", async () => {
    const dir = brain({ "00-about/company.md": note("Us") });
    const { store } = await runsWith([{ ...READ, noteIds: ["00-about/gone"] }]);

    const graph = await buildGraph(open(dir), store);
    // The run log remembers the read; the brain no longer has the note. The
    // files are the source of truth, so the picture follows them.
    expect(graph.nodes.map((n) => n.id)).toEqual(["00-about/company"]);
  });

  it("draws no read edges unless asked", async () => {
    const dir = brain({ "00-about/company.md": note("Us") });
    const { store } = await runsWith([READ]);

    const quiet = await buildGraph(open(dir), store);
    expect(quiet.edges.filter((e) => e.kind === "read")).toEqual([]);

    const loud = await buildGraph(open(dir), store, { includeReads: true });
    expect(loud.edges.filter((e) => e.kind === "read")).toHaveLength(1);
  });
});

describe("who wrote what", () => {
  it("joins the write from the run log", async () => {
    const dir = brain({ "40-deliverables/marketing/offer.md": note("Offer", "Copy.") });
    const { store, runId } = await runsWith(
      [{ type: "brain_note_written", noteId: "40-deliverables/marketing/offer", status: "draft" }],
      "copywriter",
    );

    const graph = await buildGraph(open(dir), store);
    const offer = graph.nodes.find((n) => n.id === "40-deliverables/marketing/offer");

    expect(offer?.wroteBy?.agentId).toBe("copywriter");
    expect(offer?.wroteBy?.runId).toBe(runId);
  });
});

describe("one note at a time", () => {
  it("gives the node and the edges that touch it", async () => {
    const dir = brain({
      "00-about/company.md": note("Us", "We serve [[10-customers/acme]]."),
      "10-customers/acme.md": note("Acme"),
    });
    const delta = noteIndexedDelta(open(dir), "10-customers/acme");

    expect(delta?.node.id).toBe("10-customers/acme");
    // The incoming link as well as the outgoing ones: an arrow has two ends and
    // the far one has to be redrawn too.
    expect(delta?.edges).toContainEqual({
      from: "00-about/company",
      to: "10-customers/acme",
      kind: "link",
    });
  });

  it("is undefined for a note the index does not have", async () => {
    const dir = brain({ "00-about/a.md": note("A") });
    expect(noteIndexedDelta(open(dir), "00-about/nope")).toBeUndefined();
  });

  it("repoints what linked to a deleted note at a hole", async () => {
    const dir = brain({
      "00-about/company.md": note("Us", "We serve [[10-customers/acme]]."),
      "10-customers/acme.md": note("Acme"),
    });
    const index = open(dir);
    index.removeFile(join(dir, "10-customers/acme.md"));

    const delta = noteRemovedDelta(index, "10-customers/acme");
    expect(delta.id).toBe("10-customers/acme");
    expect(delta.nowMissing?.kind).toBe("missing");
    expect(delta.edges).toContainEqual({
      from: "00-about/company",
      to: missingId("10-customers/acme"),
      kind: "link",
    });
  });

  it("leaves no hole behind when nothing pointed at the note", async () => {
    const dir = brain({ "00-about/a.md": note("A"), "00-about/b.md": note("B") });
    const index = open(dir);
    index.removeFile(join(dir, "00-about/b.md"));

    const delta = noteRemovedDelta(index, "00-about/b");
    expect(delta.nowMissing).toBeUndefined();
    expect(delta.edges).toEqual([]);
  });
});

describe("a brain with nothing in it", () => {
  it("is an empty graph rather than a failure", async () => {
    const dir = brain({});
    const graph = await buildGraph(open(dir), emptyRuns());

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.generatedAt).toMatch(/^\d{4}-/);
  });
});
