/**
 * `staffroom migrate`, and `--dry-run` for looking first.
 *
 * The office migrates itself at boot, so this command exists for the two times
 * that is not enough: somebody who wants to know what would change before it
 * does, and somebody whose office will not open because it was written by a
 * newer Staffroom and who needs to be told that in a terminal rather than find
 * it in a log.
 *
 * Both paths call the same function, so the dry run and the real thing cannot
 * disagree about what would happen.
 */
import { existsSync } from "node:fs";
import { migrateLines, migrateOffice } from "@staffroom/server";

export interface MigrateCommandOptions {
  officeDir: string;
  dryRun?: boolean;
}

export interface MigrateCommandResult {
  changed: number;
  tooNew: boolean;
}

export function migrateCommand(
  options: MigrateCommandOptions,
  log: (line: string) => void = console.log,
): MigrateCommandResult {
  if (!existsSync(options.officeDir)) {
    throw new Error(`There is no folder at ${options.officeDir}.`);
  }

  const dryRun = options.dryRun === true;
  const result = migrateOffice(options.officeDir, { dryRun });

  log("");
  for (const line of migrateLines(result, dryRun)) log(line.length === 0 ? "" : `  ${line}`);
  log("");

  return { changed: result.applied.length, tooNew: result.tooNew !== undefined };
}
