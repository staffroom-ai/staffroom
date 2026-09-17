/**
 * A note's front matter, and the rules for reading it.
 *
 * The governing principle: a note is never dropped for bad metadata. Front matter
 * that will not parse indexes the body anyway, because the owner's notes are more
 * important than our schema.
 */

export interface NoteFrontMatter {
  title: string;
  /** ISO 8601 with offset. Falls back to the file's birth time. */
  created: string;
  updated?: string;
  tags?: string[];
  written_by: "owner" | `agent:${string}`;
  /** A task id, or `routine:<routineId>`. */
  task?: string;
  run?: string;
  tools_used?: string[];
  model?: string;
  department?: string;
  /** Deliverables only. */
  status?: "draft" | "approved" | "sent" | "rejected";
  revises?: string;
  /** Included in the always-on context set given to every agent. */
  pinned?: boolean;
  /** Never indexed, never seen by an agent. */
  private?: boolean;
  /** Shipped by a template rather than written by the owner. */
  sample?: boolean;
  links?: string[];
}

export type NoteTrust = "owner" | "agent" | "imported";

export interface ParsedNote {
  id: string;
  path: string;
  title: string;
  body: string;
  frontMatter: NoteFrontMatter;
  trust: NoteTrust;
  weight: number;
  wordCount: number;
  contentHash: string;
  /** Problems worth telling the owner about, none of which stopped the note indexing. */
  warnings: NoteWarning[];
}

export interface NoteWarning {
  scope: "note";
  id: string;
  reason: "missing_created" | "invalid_front_matter" | "missing_title";
}

/**
 * A note as the graph needs it: what the owner wrote about it, not its body.
 *
 * Separate from `ParsedNote` because that carries the full text and is what the
 * indexer produces from a file; this is what comes back out of the index for
 * every note at once.
 */
export interface BrainNoteRecord {
  id: string;
  title: string;
  frontMatter: NoteFrontMatter;
  /** Last modified, in epoch milliseconds. */
  mtime: number;
  wordCount: number;
  trust: NoteTrust;
  sample: boolean;
}

export interface BrainSearchHit {
  id: string;
  title: string;
  score: number;
  excerpt: string;
  frontMatter: NoteFrontMatter;
}

/** Archived and inbox notes still answer a search, at half the weight, and are never pinned. */
export const HALF_WEIGHT_PREFIXES = ["90-archive/", "inbox/"];
export const DEFAULT_WEIGHT = 1;
export const REDUCED_WEIGHT = 0.5;

/**
 * The part of a provider the brain needs to embed a note.
 *
 * Structural rather than the whole adapter, so the index does not depend on the
 * provider layer and a test can pass a function.
 */
export interface EmbeddingProvider {
  id: string;
  embed?(texts: string[], model: string): Promise<number[][]>;
}
