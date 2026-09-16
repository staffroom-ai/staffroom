/**
 * `brain import` and `brain reindex`.
 *
 * Both exist because the brain is a folder of files rather than a database, and
 * that promise cuts both ways: the owner can put files in it by hand, and the
 * index can therefore be wrong about what is there. Import is the polite way in;
 * reindex is how you tell the office to look again.
 *
 * Reindex is deliberately safe to run at any time. The index is a cache of the
 * files, never the other way round, so the worst a reindex can do is take a
 * minute — which is why it also works when the index has been deleted outright.
 */
import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BrainIndex,
  type ImportSummary,
  importBrain,
  loadConfig,
  type NoteWarning,
  summaryLines,
} from "@staffroom/core";

export interface ImportCommandOptions {
  officeDir: string;
  source: string;
  move?: boolean;
  area?: string;
  includeTools?: boolean;
}

/** Where the brain lives, from config.yaml, because the owner may have moved it. */
function brainDirOf(officeDir: string): string {
  try {
    return join(officeDir, loadConfig(officeDir).config.brain.dir);
  } catch {
    // A config that will not parse is a problem for the office to report; an
    // import should still know where notes go.
    return join(officeDir, "brain");
  }
}

export function importIntoBrain(
  options: ImportCommandOptions,
  log: (line: string) => void = console.log,
): ImportSummary {
  const source = resolve(options.source);

  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`There is no folder at ${source}.`);
  }

  const brainDir = brainDirOf(options.officeDir);

  // Refused rather than merged: importing the brain into itself would walk the
  // folder it is writing into, and the result would be unbounded.
  if (resolve(brainDir) === source || source.startsWith(`${resolve(brainDir)}/`)) {
    throw new Error("That folder is already inside this office's brain.");
  }

  const summary = importBrain(source, brainDir, {
    ...(options.move === undefined ? {} : { move: options.move }),
    ...(options.area === undefined ? {} : { area: options.area }),
    ...(options.includeTools === undefined ? {} : { includeTools: options.includeTools }),
  });

  log("");
  for (const line of summaryLines(summary)) log(`  ${line}`);
  log("");
  log(`  They are markdown files in ${brainDir}. Open them, edit them, delete them.`);
  log("");

  return summary;
}

export interface ReindexOptions {
  officeDir: string;
  /** Not supported yet; the flag is accepted so the message can say so. */
  embeddings?: boolean;
}

export interface ReindexResult {
  notes: number;
  warnings: NoteWarning[];
}

/**
 * Reads every note again from scratch.
 *
 * The index file is deleted first rather than updated in place. It is a cache,
 * and the reason anybody runs this is that they no longer trust it — repairing
 * what they came here to replace would be answering a different question.
 */
export function reindexBrain(
  options: ReindexOptions,
  log: (line: string) => void = console.log,
): ReindexResult {
  const brainDir = brainDirOf(options.officeDir);

  if (!existsSync(brainDir)) {
    throw new Error(`There is no brain folder at ${brainDir}.`);
  }

  if (options.embeddings === true) {
    log("");
    log("  Embeddings are not in this version, so this is an ordinary reindex.");
  }

  const indexFile = join(options.officeDir, "brain.index.sqlite");
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      rmSync(`${indexFile}${suffix}`, { force: true });
    } catch {
      // Already gone, or held open by a running office. Either way the rebuild
      // below is what matters, and it will say if it could not do its job.
    }
  }

  const warnings: NoteWarning[] = [];
  const index = BrainIndex.open(brainDir, {
    indexFile,
    onWarning: (warning) => warnings.push(warning),
  });

  const notes = index.count();
  index.close();

  log("");
  log(`  Read ${notes} ${notes === 1 ? "note" : "notes"} from ${brainDir}.`);

  if (warnings.length > 0) {
    log("");
    // Printed rather than counted: each one names a file the owner can open.
    for (const warning of warnings) log(`  ${warning.id}: ${wordFor(warning.reason)}`);
    log("");
    log("  Every one of those was indexed anyway. Nothing was thrown away.");
  }

  log("");
  return { notes, warnings };
}

function wordFor(reason: NoteWarning["reason"]): string {
  switch (reason) {
    case "missing_created":
      return "no created date, so the file's own was used";
    case "invalid_front_matter":
      return "the front matter would not parse, so only the text was indexed";
    case "missing_title":
      return "no title, so the filename was used";
    default:
      return reason;
  }
}
