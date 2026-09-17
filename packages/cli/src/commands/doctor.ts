/**
 * Printing what the doctor found.
 *
 * The checking itself lives in @staffroom/server; this is presentation only, so
 * the office in the browser and the terminal can never disagree about the state
 * of the same folder.
 */

import { join } from "node:path";
import { type DoctorCheck, runDoctor } from "@staffroom/server";
import { resolveOfficeDir } from "../office-dir.js";
import { buildBundle } from "./bundle.js";

const MARK: Record<DoctorCheck["status"], string> = {
  ok: "ok  ",
  warn: "warn",
  fail: "FAIL",
};

export function formatChecks(checks: DoctorCheck[]): string {
  const width = Math.max(...checks.map((c) => c.id.length), 0);
  const lines: string[] = [];

  for (const check of checks) {
    lines.push(`  ${MARK[check.status]}  ${check.id.padEnd(width)}  ${check.message}`);
    // The hint is the half that matters on a failure, so it is never folded into
    // the message where a narrow terminal could cut it off.
    if (check.hint !== undefined) lines.push(`        ${" ".repeat(width)}  ${check.hint}`);
    if (check.fixed === true) lines.push(`        ${" ".repeat(width)}  (fixed)`);
  }

  return lines.join("\n");
}

export function summary(checks: DoctorCheck[]): string {
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  if (failed > 0) return `${failed} problem(s) to fix, ${warned} worth a look.`;
  if (warned > 0) return `Nothing broken, ${warned} worth a look.`;
  return "Everything checks out.";
}

export interface DoctorCommandOptions {
  office?: string;
  json?: boolean;
  fix?: boolean;
  /** Writes a support bundle instead of only printing. */
  bundle?: string | boolean;
}

export async function doctor(
  options: DoctorCommandOptions,
  log: (line: string) => void = console.log,
): Promise<boolean> {
  const resolved = resolveOfficeDir({
    flag: options.office,
    env: process.env["STAFFROOM_OFFICE"],
  });

  const result = await runDoctor({ officeDir: resolved.dir, fix: options.fix === true });

  if (options.json === true) {
    log(JSON.stringify(result, null, 2));
    return result.ok;
  }

  const report = [formatChecks(result.checks), "", `  ${summary(result.checks)}`].join("\n");

  log("");
  log(report);
  log("");

  if (options.bundle !== undefined && options.bundle !== false) {
    const out =
      typeof options.bundle === "string"
        ? options.bundle
        : join(process.cwd(), "staffroom-bundle.zip");

    const bundle = buildBundle({
      officeDir: resolved.dir,
      out,
      report: `Staffroom doctor, ${new Date().toISOString()}\n\n${report}\n`,
    });

    log(`  Wrote ${bundle.path}`);
    log(`  ${bundle.files.length} file(s), ${bundle.redactions} secret value(s) replaced by name.`);
    // Said every time, not once: the owner is about to send this to somebody.
    log("  Your .env is not in it. Read it before you send it.");
    log("");
  }

  return result.ok;
}
