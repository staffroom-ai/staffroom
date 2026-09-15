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

  let created = typeof front.created === "string" ? front.created : undefined;
  if (created === undefined) {
    created = birthTime.toISOString();
    warnings.push({ scope: "note", id, reason: "missing_created" });
  }

  const frontMatter: NoteFrontMatter = {
    ...front,
    title,
    created,
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

/** Folders and files the index never looks at. */
export function isSkipped(relativePath: string): boolean {
  const parts = relativePath.split("\\").join("/").split("/");
  return parts.some(
    (part, i) =>
      part.startsWith(".") ||
      part === "_attachments" ||
      part === "_private" ||
      (i === parts.length - 1 && !part.toLowerCase().endsWith(".md")),
  );
}
