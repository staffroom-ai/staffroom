/**
 * The brain as a picture: what is written down, what links to what, and who has
 * been reading it.
 *
 * The graph is assembled rather than stored. Notes and links come from the index,
 * which is a cache of the files; who read what and who wrote what come from the
 * run log, which is a record of what happened. Neither half is kept in the other,
 * so neither can go stale against the files or quietly rewrite history.
 *
 * Two things worth knowing about the shape:
 *
 *   A link to a note that does not exist becomes a `missing` node rather than
 *   disappearing. An owner who wrote [[pricing]] and never made the note should
 *   see a gap where they expected a note, not a graph that silently agrees with
 *   itself.
 *
 *   `read` edges are off by default. Every agent read is an edge, and a busy
 *   office produces thousands; drawn by default they would bury the links the
 *   owner actually wrote.
 */
import type { RunEventEnvelope, RunStore } from "../runtime/events.js";
import type { BrainIndex } from "./index.js";
import type { BrainNoteRecord } from "./types.js";

export interface BrainGraphNode {
  /** A note id, or `missing:<target>` for something linked to but never written. */
  id: string;
  kind: "note" | "deliverable" | "sample" | "missing";
  title: string;
  area: string;
  department?: string;
  writtenBy: "owner" | `agent:${string}`;
  trust: "owner" | "agent" | "imported";
  pinned: boolean;
  status?: "draft" | "approved" | "sent" | "rejected";
  created: string;
  updated: string;
  wordCount: number;
  /** Last 20, newest first. */
  readBy: Array<{ agentId: string; runId: string; at: string }>;
  wroteBy?: { agentId: string; runId: string; taskId: string; at: string };
}

export interface BrainGraphEdge {
  from: string;
  to: string;
  kind: "link" | "revises" | "read";
}

export interface BrainGraph {
  generatedAt: string;
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
}

export interface BuildGraphOptions {
  /** Adds one edge per agent read. Off by default; see the header. */
  includeReads?: boolean;
  /**
   * How far back through the run log to join.
   *
   * The reads and writes are a join over every event of every run, so this is
   * bounded on purpose. An office a year old should still open its graph.
   */
  runLimit?: number;
  /** Per note. The spec's number, and enough to see a pattern without a wall. */
  readsPerNote?: number;
}

const DEFAULT_RUN_LIMIT = 200;
const DEFAULT_READS_PER_NOTE = 20;

export function missingId(target: string): string {
  return `missing:${target}`;
}

/**
 * What a note is, for someone looking at the picture.
 *
 * Where it lives wins over where it came from: a deliverable shipped in a
 * template is still a deliverable, and calling it `sample` instead would hide
 * every piece of work in the demo office. `sample` is for the template's
 * background material, which is most of it.
 */
export function nodeKind(record: BrainNoteRecord): BrainGraphNode["kind"] {
  if (record.id.startsWith("40-deliverables/")) return "deliverable";
  if (record.sample) return "sample";
  return "note";
}

function nodeFor(record: BrainNoteRecord): BrainGraphNode {
  const front = record.frontMatter;
  const created = front.created === "" ? new Date(record.mtime).toISOString() : front.created;

  return {
    id: record.id,
    kind: nodeKind(record),
    title: record.title,
    area: record.id.split("/")[0] ?? "",
    ...(front.department === undefined ? {} : { department: front.department }),
    writtenBy: front.written_by ?? "owner",
    trust: record.trust,
    pinned: front.pinned === true,
    ...(front.status === undefined ? {} : { status: front.status }),
    created,
    updated: front.updated ?? new Date(record.mtime).toISOString(),
    wordCount: record.wordCount,
    readBy: [],
  };
}

function missingNode(target: string): BrainGraphNode {
  const now = new Date(0).toISOString();
  return {
    id: missingId(target),
    kind: "missing",
    // The name the owner typed, so they can see what they meant to write.
    title: target,
    area: target.split("/")[0] ?? "",
    writtenBy: "owner",
    trust: "owner",
    pinned: false,
    created: now,
    updated: now,
    wordCount: 0,
    readBy: [],
  };
}

interface Joined {
  readBy: Map<string, BrainGraphNode["readBy"]>;
  wroteBy: Map<string, NonNullable<BrainGraphNode["wroteBy"]>>;
  reads: BrainGraphEdge[];
}

/**
 * Walks the run log once, collecting who read what and who wrote what.
 *
 * A run that cannot be read is skipped rather than failing the graph: the log is
 * evidence about the past, and one damaged row is not a reason to refuse to
 * draw the present.
 */
async function joinRuns(
  runs: RunStore,
  options: { runLimit: number; readsPerNote: number; includeReads: boolean },
): Promise<Joined> {
  const readBy = new Map<string, BrainGraphNode["readBy"]>();
  const wroteBy = new Map<string, NonNullable<BrainGraphNode["wroteBy"]>>();
  const reads: BrainGraphEdge[] = [];

  const list = await runs.list({ limit: options.runLimit });

  for (const run of list) {
    let events: AsyncIterable<RunEventEnvelope>;
    try {
      events = runs.events(run.id);
    } catch {
      continue;
    }

    try {
      for await (const envelope of events) {
        const event = envelope.event;

        if (event.type === "brain_note_written") {
          // Last writer wins, and runs come back newest first, so the first one
          // seen for a note is the one to keep.
          if (!wroteBy.has(event.noteId)) {
            wroteBy.set(event.noteId, {
              agentId: run.agentId,
              runId: run.id,
              taskId: run.parentRunId ?? run.id,
              at: new Date(envelope.at).toISOString(),
            });
          }
          continue;
        }

        if (event.type !== "tool_result") continue;
        if (event.name !== "brain_search" && event.name !== "brain_read") continue;
        if (event.noteIds === undefined) continue;

        for (const noteId of event.noteIds) {
          const entries = readBy.get(noteId) ?? [];
          if (entries.length >= options.readsPerNote) continue;
          entries.push({
            agentId: run.agentId,
            runId: run.id,
            at: new Date(envelope.at).toISOString(),
          });
          readBy.set(noteId, entries);

          if (options.includeReads) {
            reads.push({ from: `agent:${run.agentId}`, to: noteId, kind: "read" });
          }
        }
      }
    } catch {
      // A run whose events will not read through is left out of the join.
    }
  }

  return { readBy, wroteBy, reads };
}

export async function buildGraph(
  index: BrainIndex,
  runs: RunStore,
  options: BuildGraphOptions = {},
): Promise<BrainGraph> {
  const includeReads = options.includeReads === true;
  const records = index.records();
  const known = new Set(records.map((r) => r.id));

  const nodes = new Map<string, BrainGraphNode>();
  for (const record of records) nodes.set(record.id, nodeFor(record));

  const edges: BrainGraphEdge[] = [];

  for (const link of index.links()) {
    // Links out of a note we do not have are not ours to draw: the note that
    // would be at the other end of the arrow does not exist either.
    if (!known.has(link.from)) continue;

    if (link.resolved && known.has(link.to)) {
      edges.push({ from: link.from, to: link.to, kind: "link" });
      continue;
    }

    const id = missingId(link.to);
    if (!nodes.has(id)) nodes.set(id, missingNode(link.to));
    edges.push({ from: link.from, to: id, kind: "link" });
  }

  // A revision is a different relationship from a link and gets its own kind:
  // "this replaced that" is the one edge the owner reads as history.
  for (const record of records) {
    const revises = record.frontMatter.revises;
    if (revises === undefined || revises === record.id) continue;
    if (known.has(revises)) {
      edges.push({ from: record.id, to: revises, kind: "revises" });
    } else {
      const id = missingId(revises);
      if (!nodes.has(id)) nodes.set(id, missingNode(revises));
      edges.push({ from: record.id, to: id, kind: "revises" });
    }
  }

  const joined = await joinRuns(runs, {
    runLimit: options.runLimit ?? DEFAULT_RUN_LIMIT,
    readsPerNote: options.readsPerNote ?? DEFAULT_READS_PER_NOTE,
    includeReads,
  });

  for (const [noteId, entries] of joined.readBy) {
    const node = nodes.get(noteId);
    if (node !== undefined) node.readBy = entries;
  }
  for (const [noteId, wroteBy] of joined.wroteBy) {
    const node = nodes.get(noteId);
    if (node !== undefined) node.wroteBy = wroteBy;
  }

  // Only reads of notes that are actually in the picture.
  if (includeReads) {
    for (const edge of joined.reads) {
      if (nodes.has(edge.to)) edges.push(edge);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges,
  };
}

/**
 * The chain a note belongs to, oldest first.
 *
 * Walks back through `revises` to the original and forward to the latest, so
 * asking about any note in a chain gives the same answer. A chain that points
 * at itself, directly or round a loop, stops rather than spinning: front matter
 * is owner-editable and nothing stops somebody typing a cycle.
 */
export function brainRevisions(index: BrainIndex, noteId: string): BrainNoteRecord[] {
  const byId = new Map(index.records().map((r) => [r.id, r]));
  const start = byId.get(noteId);
  if (start === undefined) return [];

  const older: BrainNoteRecord[] = [];
  const seen = new Set<string>([start.id]);
  let cursor = start;
  for (;;) {
    const previous = cursor.frontMatter.revises;
    if (previous === undefined || seen.has(previous)) break;
    const record = byId.get(previous);
    if (record === undefined) break;
    seen.add(previous);
    older.unshift(record);
    cursor = record;
  }

  const newer: BrainNoteRecord[] = [];
  let tail = start;
  for (;;) {
    const next = [...byId.values()].find(
      (r) => r.frontMatter.revises === tail.id && !seen.has(r.id),
    );
    if (next === undefined) break;
    seen.add(next.id);
    newer.push(next);
    tail = next;
  }

  return [...older, start, ...newer];
}

/**
 * One note's worth of graph, for `brain.note.indexed`.
 *
 * The office pushes the note and the edges that touch it rather than a whole new
 * graph every time somebody saves a file. Reads and writes are left off: this
 * fires from a file watcher, and going to the run log on every keystroke in
 * Obsidian would be a database scan per save.
 */
export function noteIndexedDelta(
  index: BrainIndex,
  noteId: string,
): { node: BrainGraphNode; edges: BrainGraphEdge[] } | undefined {
  const record = index.records().find((r) => r.id === noteId);
  if (record === undefined) return undefined;

  const known = new Set(index.records().map((r) => r.id));
  const edges: BrainGraphEdge[] = [];

  for (const link of index.links()) {
    if (link.from !== noteId && link.to !== noteId) continue;
    const to = link.resolved && known.has(link.to) ? link.to : missingId(link.to);
    edges.push({ from: link.from, to, kind: "link" });
  }

  const revises = record.frontMatter.revises;
  if (revises !== undefined && revises !== noteId) {
    edges.push({
      from: noteId,
      to: known.has(revises) ? revises : missingId(revises),
      kind: "revises",
    });
  }

  return { node: nodeFor(record), edges };
}

/**
 * What deleting a note does to the picture, for `brain.note.removed`.
 *
 * Not just "remove this node". Anything that linked to it is now pointing at
 * something that is not there, and those arrows have to be redrawn at a
 * `missing` node or the graph would show the owner a tidy picture of a brain
 * that has a hole in it. Call this after the note has left the index.
 */
export function noteRemovedDelta(
  index: BrainIndex,
  noteId: string,
): { id: string; nowMissing?: BrainGraphNode; edges: BrainGraphEdge[] } {
  const edges: BrainGraphEdge[] = [];

  for (const link of index.links()) {
    if (link.to !== noteId) continue;
    edges.push({ from: link.from, to: missingId(noteId), kind: "link" });
  }
  for (const record of index.records()) {
    if (record.frontMatter.revises !== noteId) continue;
    edges.push({ from: record.id, to: missingId(noteId), kind: "revises" });
  }

  return {
    id: noteId,
    ...(edges.length === 0 ? {} : { nowMissing: missingNode(noteId) }),
    edges,
  };
}
