/**
 * Writing a deliverable into the brain.
 *
 * Two rules make this safe to give an agent. It can only ever create a new file
 * under 40-deliverables/<department>/, so there is no path an agent can name that
 * reaches the owner's own notes. And it never overwrites: a collision gets a
 * suffix, so nothing an agent does can lose work.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { stringify } from "yaml";
import type { NoteFrontMatter } from "./types.js";

export const DELIVERABLES_ROOT = "40-deliverables";

export interface WriteDeliverableInput {
  title: string;
  body: string;
  department: string;
  agentId: string;
  runId: string;
  /** A task id, or `routine:<routineId>`. */
  task?: string;
  model?: string;
  toolsUsed?: string[];
  /** Note id this revises. Its status flips to rejected. */
  revises?: string;
  /** Notes read during the run, linked so the graph shows what informed this. */
  links?: string[];
  /** Overridden in tests; defaults to today. */
  now?: Date;
}

export interface WrittenNote {
  id: string;
  path: string;
  frontMatter: NoteFrontMatter;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "untitled";
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function writeDeliverable(brainDir: string, input: WriteDeliverableInput): WrittenNote {
  const now = input.now ?? new Date();
  const folder = join(brainDir, DELIVERABLES_ROOT, input.department);
  mkdirSync(folder, { recursive: true });

  // Never overwrite. Two deliverables with the same title on one day both survive.
  const base = `${isoDate(now)}-${slugify(input.title)}`;
  let name = base;
  let suffix = 1;
  while (existsSync(join(folder, `${name}.md`))) {
    suffix++;
    name = `${base}-${suffix}`;
  }

  const frontMatter: NoteFrontMatter = {
    title: input.title,
    created: now.toISOString(),
    written_by: `agent:${input.agentId}`,
    department: input.department,
    run: input.runId,
    status: "draft",
    ...(input.task === undefined ? {} : { task: input.task }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.toolsUsed?.length ? { tools_used: input.toolsUsed } : {}),
    ...(input.revises === undefined ? {} : { revises: input.revises }),
    ...(input.links?.length ? { links: input.links } : {}),
  };

  const path = join(folder, `${name}.md`);
  writeFileSync(
    path,
    `---\n${stringify(frontMatter).trimEnd()}\n---\n\n${input.body.trim()}\n`,
    "utf8",
  );

  // A revision supersedes what it revises, and says so on the older note.
  if (input.revises !== undefined) markRejected(brainDir, input.revises);

  return { id: `${DELIVERABLES_ROOT}/${input.department}/${name}`, path, frontMatter };
}

/**
 * Clears `pinned` on a note, leaving the rest of the file as it was.
 *
 * Returns the text unchanged when it was not pinned, so a caller can tell
 * whether anything needs writing and leave the file's mtime alone if not.
 */
export function unpinned(text: string): string {
  try {
    const parsed = matter(text);
    // Copied, never mutated in place. gray-matter caches by content and hands
    // the same `data` object back for identical input, so editing it would edit
    // every other note that happens to read the same — which two offices on one
    // machine from the same template do, every time.
    const data = { ...(parsed.data as Partial<NoteFrontMatter>) };
    if (data.pinned !== true) return text;
    data.pinned = false;
    return `---\n${stringify(data).trimEnd()}\n---\n\n${parsed.content.trim()}\n`;
  } catch {
    // Front matter that will not round-trip is left exactly as the owner wrote
    // it. Losing their text to tidy one flag would be a poor trade.
    return text;
  }
}

/** Flips a draft to rejected and changes nothing else about the file. */
export function markRejected(brainDir: string, noteId: string): boolean {
  const path = join(brainDir, `${noteId}.md`);
  if (!existsSync(path)) return false;
  try {
    const parsed = matter(readFileSync(path, "utf8"));
    // Copied for the same reason as in `unpinned` above: gray-matter's cache
    // shares one `data` object between identical files.
    const data = { ...(parsed.data as Partial<NoteFrontMatter>) };
    if (data.status !== "draft") return false;
    data.status = "rejected";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `---\n${stringify(data).trimEnd()}\n---\n\n${parsed.content.trim()}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}
