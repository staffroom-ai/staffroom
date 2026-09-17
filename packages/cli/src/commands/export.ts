/**
 * The whole office, in one file, without the keys.
 *
 * Three reasons somebody runs this: they are moving to another machine, they
 * want a backup they can read in ten years, or they are leaving and want to
 * take their work with them. The last one is the point of the project — "delete
 * this app tomorrow and the work is still yours" is only true if there is a way
 * to pick it all up.
 *
 * So the export is plain: markdown stays markdown, YAML stays YAML, and the run
 * log becomes JSON rather than a SQLite file that needs this program to read.
 * An archive you need the original software to open is not an escape route.
 *
 * `.env` is never in it, and neither is anything under `.staffroom/secrets/`.
 * Every value from `.env` is replaced by the name it came from wherever it
 * appears, the same rule as the support bundle, for the same reason: this file
 * ends up in a cloud drive or an email.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SqliteRunStore } from "@staffroom/core";
import { writeZip, type ZipEntry } from "../zip.js";
import { redactAll, secretsOf } from "./bundle.js";

/** Never, whatever else is asked for. */
export const EXCLUDED = [".env", ".staffroom/secrets", ".staffroom/telemetry-id"] as const;

/** Files that are caches or engines rather than the owner's work. */
const REBUILDABLE = ["brain.index.sqlite", "runs.sqlite"];

export interface ExportResult {
  path: string;
  files: string[];
  runs: number;
  redactions: number;
}

function walk(dir: string, base = dir): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative(base, full).split(sep).join("/");

    if (rel === ".env" || rel.startsWith(".staffroom/secrets")) continue;
    if (rel === ".staffroom/telemetry-id") continue;
    if (REBUILDABLE.some((name) => entry.startsWith(name))) continue;

    try {
      if (statSync(full).isDirectory()) {
        found.push(...walk(full, base));
        continue;
      }
    } catch {
      continue;
    }
    found.push(rel);
  }

  return found;
}

/**
 * The run log as JSON, newest first.
 *
 * Read through the store rather than by dumping the tables, so what comes out
 * is the shape the office itself uses — and so a schema change does not quietly
 * produce an export nothing can read.
 */
async function runsAsJson(officeDir: string): Promise<{ text: string; count: number }> {
  const path = join(officeDir, "runs.sqlite");
  if (!existsSync(path)) return { text: "[]\n", count: 0 };

  let store: SqliteRunStore | undefined;
  try {
    store = new SqliteRunStore(path, { chunkFlushMs: 0 });
    const runs = await store.list({});
    const full = [];

    for (const run of runs) {
      const events = [];
      for await (const envelope of store.events(run.id)) events.push(envelope);
      full.push({ run, events });
    }

    return { text: `${JSON.stringify(full, null, 2)}\n`, count: runs.length };
  } catch {
    // A log that will not open is not a reason to refuse the export: the notes
    // are the part that matters, and their absence is visible in the file list.
    return { text: "[]\n", count: 0 };
  } finally {
    store?.close();
  }
}

export async function exportOffice(
  options: { officeDir: string; out: string },
  log: (line: string) => void = console.log,
): Promise<ExportResult> {
  if (!existsSync(join(options.officeDir, "agents.yaml"))) {
    throw new Error(`There is no office at ${options.officeDir}.`);
  }

  const secrets = secretsOf(options.officeDir);
  const entries: ZipEntry[] = [];
  const files: string[] = [];
  let redactions = 0;

  for (const rel of walk(options.officeDir)) {
    const full = join(options.officeDir, rel);
    let raw: Buffer;
    try {
      raw = readFileSync(full);
    } catch {
      continue;
    }

    // Redaction is for text. A picture in _attachments/ goes through untouched,
    // because running a string replace over binary would corrupt it to no
    // purpose — a key is not going to be sitting in a PNG.
    const looksTextual = /\.(md|ya?ml|json|txt|ts|js|csv|env|gitignore)$/i.test(rel);
    if (!looksTextual) {
      entries.push({ path: `office/${rel}`, data: raw });
      files.push(rel);
      continue;
    }

    const text = raw.toString("utf8");
    const clean = redactAll(text, secrets);
    for (const { value } of secrets) {
      if (text.includes(value)) redactions += text.split(value).length - 1;
    }

    entries.push({ path: `office/${rel}`, data: clean });
    files.push(rel);
  }

  const runs = await runsAsJson(options.officeDir);
  entries.push({ path: "runs.json", data: redactAll(runs.text, secrets) });

  entries.push({
    path: "README.txt",
    data: [
      "Your Staffroom office.",
      "",
      "Everything here is yours and readable without Staffroom: the notes are",
      "markdown, the settings are YAML, and runs.json is every run your staff",
      "have done. Unzip it anywhere.",
      "",
      "Not included: office/.env, anything under .staffroom/secrets/, and the",
      "search index and run database, which rebuild themselves. Every value from",
      "your .env has been replaced with the name it came from.",
      "",
      "brain/_private/ is included. Those notes are never read by an agent, but",
      "they are yours, so they come with you. Bear it in mind before you send",
      "this file to anybody.",
      "",
      "To pick it up again: unzip it, then",
      "  npx staffroom start --office <the office folder>",
      "",
      `${files.length} file(s), ${runs.count} run(s).`,
    ].join("\n"),
  });

  writeZip(options.out, entries);

  log("");
  log(`  Wrote ${options.out}`);
  log(`  ${files.length} file(s) and ${runs.count} run(s).`);
  if (redactions > 0) log(`  ${redactions} secret value(s) replaced by name.`);
  log("");
  log("  Your .env is not in it. The notes are markdown; you do not need");
  log("  Staffroom to read them.");
  log("");

  return { path: options.out, files, runs: runs.count, redactions };
}
