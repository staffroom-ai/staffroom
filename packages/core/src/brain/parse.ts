/**
 * Reading one markdown file into a note.
 */
import { createHash } from "node:crypto";
import matter from "gray-matter";
import {
  DEFAULT_WEIGHT,
  HALF_WEIGHT_PREFIXES,
  type NoteFrontMatter,
  type NoteTrust,
  type NoteWarning,
  type ParsedNote,
  REDUCED_WEIGHT,
} from "./types.js";

/** Note ids always use forward slashes, including on Windows. */
export function noteIdFor(relativePath: string): string {
  return relativePath.split("\\").join("/").replace(/\.md$/i, "");
}

export function weightFor(id: string): number {
  return HALF_WEIGHT_PREFIXES.some((p) => id.startsWith(p)) ? REDUCED_WEIGHT : DEFAULT_WEIGHT;
}

function trustFor(id: string, front: Partial<NoteFrontMatter>): NoteTrust {
  if (id.startsWith("inbox/")) return "imported";
  if (typeof front.written_by === "string" && front.written_by.startsWith("agent:")) return "agent";
  return "owner";
}

/** Accepts what YAML may produce for a date field: a string, or a Date. */
function toIsoString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
}

export interface ParseOptions {
  id: string;
  path: string;
  text: string;
  /** Used when front matter has no `created`. */
  birthTime: Date;
}

export function parseNote(options: ParseOptions): ParsedNote {
  const { id, path, text, birthTime } = options;
  const warnings: NoteWarning[] = [];

  let front: Partial<NoteFrontMatter> = {};
  let body = text;
  try {
    const parsed = matter(text);
    front = (parsed.data ?? {}) as Partial<NoteFrontMatter>;
    body = parsed.content;
  } catch {
    // Bad YAML is not a reason to lose someone's note. Index the whole file.
    warnings.push({ scope: "note", id, reason: "invalid_front_matter" });
  }

  let title = typeof front.title === "string" && front.title.length > 0 ? front.title : undefined;
  if (title === undefined) {
    const heading = body.split("\n").find((l) => l.startsWith("# "));
    title = heading?.slice(2).trim();
    if (title === undefined || title.length === 0) {
      title = (id.split("/").pop() ?? id).split("-").join(" ");
      warnings.push({ scope: "note", id, reason: "missing_title" });
    }
  }

  // YAML turns an unquoted timestamp into a Date, so a correctly written note
  // arrives here as an object rather than a string. Both are valid.
  let created = toIsoString(front.created);
  if (created === undefined) {
    created = birthTime.toISOString();
    warnings.push({ scope: "note", id, reason: "missing_created" });
  }

  const updated = toIsoString(front.updated);
  const frontMatter: NoteFrontMatter = {
    ...front,
    title,
    created,
    ...(updated === undefined ? {} : { updated }),
    written_by: front.written_by ?? "owner",
  };

  return {
    id,
    path,
    title,
    body,
    frontMatter,
    trust: trustFor(id, front),
    weight: weightFor(id),
    wordCount: body.split(/\s+/).filter(Boolean).length,
    contentHash: createHash("sha256").update(text).digest("hex").slice(0, 32),
    warnings,
  };
}

/**
 * Just the front matter of a note, or undefined when it will not parse.
 *
 * For the callers that need to know one thing about a file — is this the
 * template's own content? — without paying for the body, the hash and the
 * warnings that `parseNote` produces.
 */
export function frontMatterOf(text: string): Partial<NoteFrontMatter> | undefined {
  try {
    return matter(text).data as Partial<NoteFrontMatter>;
  } catch {
    return undefined;
  }
}

/**
 * Folders and files the index never looks at.
 *
 * `_sample` is where the template's own notes go when the owner says they have
 * seen enough of Northlight Studio. Skipped rather than deleted: they asked for
 * them out of the way, not destroyed, and a folder they can open and read is a
 * kinder answer than a file that is gone.
 */
export function isSkipped(relativePath: string): boolean {
  const parts = relativePath.split("\\").join("/").split("/");
  return parts.some(
    (part, i) =>
      part.startsWith(".") ||
      part === "_attachments" ||
      part === "_private" ||
      part === "_sample" ||
      (i === parts.length - 1 && !part.toLowerCase().endsWith(".md")),
  );
}
