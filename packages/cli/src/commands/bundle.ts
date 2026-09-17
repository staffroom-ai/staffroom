/**
 * Everything somebody needs to help, and nothing they should not have.
 *
 * When an office misbehaves, the useful thing to send a maintainer is the
 * config, the doctor report and the log. The dangerous thing about sending
 * those is that the first one names secrets and the last one may have printed
 * one. So this builds the bundle rather than telling somebody to zip the folder
 * themselves, because the version they build by hand is the version with the
 * keys in it.
 *
 * The rule is absolute and deliberately dumb: `.env` never goes in, and every
 * value from it is replaced wherever it appears, in every file, whether or not
 * this code knows why it was there. Redaction that depended on understanding a
 * file's shape would fail on the one file nobody thought about.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeZip, type ZipEntry } from "../zip.js";

/** Files worth having, in the order somebody would read them. */
const WANTED = [
  "config.yaml",
  "agents.yaml",
  "routines.yaml",
  "approvals.yaml",
  ".staffroom/scheduler.json",
] as const;

/** Never, under any circumstances. */
export const NEVER = [".env", ".staffroom/secrets", ".staffroom/telemetry-id"] as const;

/**
 * Every value in the office's .env, longest first.
 *
 * Longest first matters: if one secret is a prefix of another, replacing the
 * short one first would leave the tail of the long one in the file, which looks
 * redacted and is not.
 */
export function secretsOf(officeDir: string): Array<{ name: string; value: string }> {
  const path = join(officeDir, ".env");
  if (!existsSync(path)) return [];

  const found: Array<{ name: string; value: string }> = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const name = match[1] as string;
    // Quotes stripped, because the value in config.yaml or a log line will not
    // have them and a quoted comparison would never match.
    const value = (match[2] as string).trim().replace(/^["']|["']$/g, "");
    if (value.length === 0) continue;
    found.push({ name, value });
  }

  return found.sort((a, b) => b.value.length - a.value.length);
}

/**
 * Replaces every secret with the name it came from.
 *
 * `$ANTHROPIC_API_KEY` rather than `***`, so the reader can see which key was
 * there — which is usually the thing they need to know — without seeing it.
 */
export function redactAll(text: string, secrets: Array<{ name: string; value: string }>): string {
  let out = text;
  for (const { name, value } of secrets) {
    if (out.includes(value)) out = out.split(value).join(`$${name}`);
  }
  return out;
}

export interface BundleResult {
  path: string;
  files: string[];
  /** How many replacements were made, so the owner can see it did something. */
  redactions: number;
}

/**
 * Builds the support bundle.
 *
 * `report` is the doctor output the caller already produced, passed in rather
 * than recomputed so the bundle says exactly what the owner was shown.
 */
export function buildBundle(options: {
  officeDir: string;
  out: string;
  report: string;
  log?: string;
}): BundleResult {
  const secrets = secretsOf(options.officeDir);
  const entries: ZipEntry[] = [];
  const files: string[] = [];
  let redactions = 0;

  const add = (path: string, raw: string): void => {
    const clean = redactAll(raw, secrets);
    if (clean !== raw) {
      // Counted by comparing, not by trusting the replace: the number is shown
      // to the owner as evidence, so it has to be observed rather than claimed.
      for (const { value } of secrets) {
        if (raw.includes(value)) redactions += raw.split(value).length - 1;
      }
    }
    entries.push({ path, data: clean });
    files.push(path);
  };

  add("doctor.txt", options.report);
  if (options.log !== undefined) add("staffroom.log", options.log);

  for (const name of WANTED) {
    const path = join(options.officeDir, name);
    if (!existsSync(path)) continue;
    try {
      add(name, readFileSync(path, "utf8"));
    } catch {
      // Unreadable is not worth failing the bundle over; its absence is visible
      // in the file list, which is itself information.
    }
  }

  add(
    "README.txt",
    [
      "A Staffroom support bundle.",
      "",
      "Every value from office/.env has been replaced with the name it came",
      "from, in every file here. The .env file itself is not included, and",
      "neither is anything under .staffroom/secrets/.",
      "",
      "Read it before you send it. It is your business in these files.",
      "",
      `Files: ${files.join(", ")}`,
    ].join("\n"),
  );

  writeZip(options.out, entries);
  return { path: options.out, files, redactions };
}
