/**
 * Getting Northlight Studio out of somebody's office.
 *
 * Every new office starts as a design studio in Melbourne with four staff, three
 * customers and a price list, because an empty office cannot show anybody what
 * an office does. That content has one job and it is finished the moment the
 * owner connects a model of their own — after which it is a stranger's business
 * sitting in the middle of theirs, and their staff read it as fact.
 *
 * So the office asks, once, and then never again. Three rules govern what
 * happens next:
 *
 *   Nothing the owner wrote is touched. The question names only what came with
 *   the template, and the answer only ever moves those.
 *
 *   Nothing is deleted from disk. Sample notes move to `90-archive/_sample/`,
 *   which the index skips, so they stop answering searches and stop reaching
 *   prompts while remaining files somebody can open and read. "Remove" means out
 *   of the way, not destroyed.
 *
 *   `approvals.yaml` is not touched either way. A permission the owner granted
 *   is theirs, and quietly revoking one because they tidied up would be the
 *   office deciding something it was not asked about.
 *
 * Sample runs are the exception to the second rule: they really are deleted, and
 * `runs.sqlite` is the one place that happens. They are not the owner's history
 * and there is nothing to read in them once the office is real.
 */
import type { Dirent } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { RunStore } from "@staffroom/core";
import { frontMatterOf, unpinned } from "@staffroom/core";

/** Where sample notes go. Inside the archive, and skipped by the index. */
export const SAMPLE_DIR = join("90-archive", "_sample");

/** Folders that are not walked looking for sample notes. */
const NEVER_WALK = new Set(["_attachments", "_sample"]);

/**
 * The question, in the owner's own office's words.
 *
 * Naming the business is the whole point. "Remove the sample notes" invites the
 * answer "which ones?"; "Remove the sample notes and runs from Northlight
 * Studio" is answerable by somebody who has never read a word of documentation,
 * because they know perfectly well that they are not Northlight Studio.
 */
export function sampleQuestion(officeName: string): string {
  return `Remove the sample notes and runs from ${officeName}? Your own notes are kept. (Recommended)`;
}

interface Found {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the brain folder, with forward slashes. */
  rel: string;
}

/**
 * Every note that came with the template.
 *
 * Walked off disk rather than read out of the index, because the index does not
 * hold all of them: `_private/logins.md` is sample content too, and the index
 * has never seen it. A tidy-up that left the fake logins behind would be an
 * odd thing to explain.
 */
export function findSampleNotes(brainDir: string): Found[] {
  const found: Found[] = [];
  if (!existsSync(brainDir)) return found;

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || NEVER_WALK.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;

      // Unreadable front matter is not a claim to be sample content, and a note
      // the office cannot parse is the last one to start moving around.
      let front: ReturnType<typeof frontMatterOf>;
      try {
        front = frontMatterOf(readFileSync(full, "utf8"));
      } catch {
        continue;
      }
      if (front?.sample !== true) continue;
      found.push({ path: full, rel: relative(brainDir, full).split(sep).join("/") });
    }
  };

  walk(brainDir);
  return found;
}

/**
 * Whether the office should put the question in front of anybody.
 *
 * Three conditions, and all three earn their place. Live, because a demo office
 * is supposed to be full of Northlight Studio and asking there would be asking
 * somebody to throw away the only thing they can currently look at. Unanswered,
 * because asking twice is how an office starts feeling like software that was
 * not listening. And only when there is actually sample content left, so an
 * owner who deleted it themselves, or started from a template that ships none,
 * is never asked a question about nothing.
 */
export function shouldAskAboutSamples(options: {
  mode: "live" | "demo";
  answered: boolean;
  brainDir: string;
}): boolean {
  if (options.mode !== "live") return false;
  if (options.answered) return false;
  return findSampleNotes(options.brainDir).length > 0;
}

export interface LeaveResult {
  notesMoved: number;
  runsDeleted: number;
  /** Notes that could not be moved, by path. Named rather than counted. */
  failed: string[];
}

/**
 * Moves the template's notes aside and deletes its runs.
 *
 * The sub-path is kept under `_sample/`, so `00-about/company.md` becomes
 * `90-archive/_sample/00-about/company.md`. Two reasons: four templates have a
 * `company.md` and flattening would lose three of them, and a folder that still
 * reads like the office it came from is one somebody can make sense of later.
 */
export async function leaveDemo(options: {
  brainDir: string;
  store: RunStore;
}): Promise<LeaveResult> {
  const { brainDir, store } = options;
  const failed: string[] = [];
  let notesMoved = 0;

  for (const note of findSampleNotes(brainDir)) {
    const to = join(brainDir, SAMPLE_DIR, ...note.rel.split("/"));
    try {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(note.path, to);
      // Unpinned once it has landed. The index skips `_sample/` so this changes
      // nothing today; it matters on the day somebody drags one back out, when
      // a note they meant to archive would otherwise reappear in every prompt
      // their staff read.
      const text = readFileSync(to, "utf8");
      const flat = unpinned(text);
      if (flat !== text) writeFileSync(to, flat, "utf8");
      notesMoved += 1;
    } catch {
      failed.push(note.rel);
    }
  }

  const runsDeleted = await store.deleteSamples();
  return { notesMoved, runsDeleted, failed };
}
