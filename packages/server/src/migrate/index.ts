/**
 * Bringing an owner's config files forward when Staffroom learns something new.
 *
 * The whole product rests on the files being theirs: they can open them, read
 * them, and edit them in any editor. That promise is what makes migration a
 * delicate thing rather than a routine one. A migration is Staffroom writing to
 * a file it does not own, so four rules hold:
 *
 *   The file is edited, not rewritten. Every migration works on a yaml Document
 *   so comments, key order and formatting survive. A tidy-up that silently ate
 *   somebody's notes to themselves would cost more than the setting was worth.
 *
 *   The old file is kept, at `.staffroom/backups/<file>.v<from>.bak`, before a
 *   byte is written. Not because migrations are expected to go wrong, but
 *   because the owner has no other copy and did not ask for this to happen.
 *
 *   Running it twice does nothing the second time. Migrations are selected by
 *   the version in the file, and a migration's last act is to set the new one,
 *   so a second boot matches nothing. This matters more than it sounds: the
 *   office boots on every `npx staffroom`, and a migration that re-ran would
 *   make a new backup each time and eventually be the largest thing in the
 *   folder.
 *
 *   A file from the future is refused, not guessed at. `CONFIG_VERSION_UNKNOWN`
 *   says to update Staffroom rather than opening an office on settings this
 *   build does not understand.
 *
 * On deprecated keys: when a migration renames one, the old name keeps working,
 * with a warning, for two minor releases before it becomes an error. Nothing is
 * deprecated yet — the one migration here adds a key rather than moving one — so
 * there is no table of them to maintain. The first rename adds it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConfigFile } from "@staffroom/core";
import { type Document, parseDocument } from "yaml";

/** The newest config.yaml this build writes and understands. */
export const CONFIG_VERSION = 2;

export interface Migration {
  file: ConfigFile;
  from: number;
  to: number;
  /** One line, in the owner's terms, for `migrate --dry-run` to print. */
  describe: string;
  /** Edits the document in place. False means it found nothing to do. */
  run(doc: Document): boolean;
}

/**
 * v1 → v2: say out loud how long "always allow" lasts.
 *
 * `approvals.whitelist_days` arrived with "Approve and always allow". Offices
 * created before it have been using the 90-day default without it appearing
 * anywhere they could see, which for a setting that decides how long an agent
 * may send email unattended is the wrong way round. Written explicitly so it is
 * a line they can read and change, not a default they have to find out about.
 */
export const APPROVALS_WHITELIST_DAYS: Migration = {
  file: "config.yaml",
  from: 1,
  to: 2,
  describe: "Write approvals.whitelist_days into config.yaml, so you can see how long it is.",
  run(doc) {
    const approvals = doc.get("approvals") as { has?: (k: string) => boolean } | undefined;

    if (approvals?.has === undefined) {
      // No approvals block at all, which is an office that never opened the
      // file. Both keys, so the pair reads as a set rather than one orphan.
      doc.set("approvals", { expiry_hours: 24, whitelist_days: 90 });
    } else if (!approvals.has("whitelist_days")) {
      (approvals as unknown as { set: (k: string, v: unknown) => void }).set("whitelist_days", 90);
    }

    // Always, even when the key was already there by hand: the version is what
    // stops this running again, and leaving it at 1 would mean it always did.
    doc.set("version", 2);
    return true;
  },
};

export const MIGRATIONS: Migration[] = [APPROVALS_WHITELIST_DAYS];

export function backupPath(officeDir: string, file: ConfigFile, from: number): string {
  return join(officeDir, ".staffroom", "backups", `${file}.v${from}.bak`);
}

/**
 * What the file says its version is, or 1 when it does not say.
 *
 * A file that will not parse reads as current, so nothing is written to it. The
 * loader reports a broken file properly and in the owner's terms; editing one
 * nobody has managed to read would be the worst thing this module could do.
 * Note that the yaml parser collects its errors rather than throwing, so this
 * has to ask — a try/catch here quietly treats a broken file as v1.
 */
export function versionOf(text: string): number {
  let doc: Document;
  try {
    doc = parseDocument(text);
  } catch {
    return CONFIG_VERSION;
  }
  if (doc.errors.length > 0) return CONFIG_VERSION;

  const value = doc.get("version");
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

export interface Planned {
  file: ConfigFile;
  from: number;
  to: number;
  describe: string;
}

export interface MigrateResult {
  /** What ran, or what would have. */
  applied: Planned[];
  /** Backups written. Empty on a dry run. */
  backups: string[];
  /**
   * A file this build is too old for. The office should not open on it.
   */
  tooNew?: { file: ConfigFile; version: number };
}

/**
 * Brings every config file in an office up to date.
 *
 * `dryRun` does everything except write, so `migrate --dry-run` and the real
 * thing cannot disagree about what would happen.
 */
export function migrateOffice(
  officeDir: string,
  options: { dryRun?: boolean } = {},
): MigrateResult {
  const dryRun = options.dryRun === true;
  const applied: Planned[] = [];
  const backups: string[] = [];

  for (const file of ["config.yaml"] as const) {
    const path = join(officeDir, file);
    if (!existsSync(path)) continue;

    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    const version = versionOf(text);
    if (version > CONFIG_VERSION) {
      return { applied, backups, tooNew: { file, version } };
    }

    const steps = MIGRATIONS.filter((m) => m.file === file && m.from >= version).sort(
      (a, b) => a.from - b.from,
    );
    if (steps.length === 0) continue;

    const doc = parseDocument(text);
    if (doc.errors.length > 0) continue;

    let changed = false;
    for (const step of steps) {
      if (!step.run(doc)) continue;
      changed = true;
      applied.push({ file, from: step.from, to: step.to, describe: step.describe });
    }
    if (!changed) continue;

    if (dryRun) continue;

    // The copy lands before the write, always. The owner has no other copy of
    // this file and did not ask for any of this to happen.
    const backup = backupPath(officeDir, file, version);
    try {
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(path, backup);
      backups.push(backup);
    } catch {
      // Refused rather than carried on. Editing somebody's file with no way
      // back is the one outcome this module exists to prevent.
      applied.length = 0;
      continue;
    }

    writeFileSync(path, String(doc), "utf8");
  }

  return { applied, backups };
}

/** The lines `migrate` prints. Plain sentences, not a table. */
export function migrateLines(result: MigrateResult, dryRun: boolean): string[] {
  if (result.tooNew !== undefined) {
    return [
      `${result.tooNew.file} says version ${result.tooNew.version}, and this Staffroom understands ${CONFIG_VERSION}.`,
      "Update Staffroom — npm install -g staffroom@latest — and run this again.",
    ];
  }

  if (result.applied.length === 0) return ["Your office files are already up to date."];

  const lines = result.applied.map(
    (step) => `${step.file} v${step.from} to v${step.to}: ${step.describe}`,
  );
  if (dryRun) {
    lines.push("", "Nothing was written. Run npx staffroom migrate to do it.");
  } else {
    for (const backup of result.backups) lines.push("", `The file as it was is at ${backup}.`);
  }
  return lines;
}
