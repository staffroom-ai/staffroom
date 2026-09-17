/**
 * Starting an office.
 *
 * Every step that can fail prints something the owner can act on, and the ones
 * that can degrade do rather than refusing to start. The exception is a config
 * file that will not parse: an office running on a roster the owner did not write
 * is worse than one that will not start and says why.
 */
import { ConfigInvalid, createOffice, type Office, printConfigErrors } from "@staffroom/core";
import { demoAdapters, shouldUseDemo } from "./demo/demo.js";
import { say } from "./log.js";
import { migrateLines, migrateOffice } from "./migrate/index.js";

export interface BootOptions {
  officeDir: string;
  demo?: boolean;
  demoRunsDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Where the banner and warnings go. */
  log?: (line: string) => void;
}

export interface BootResult {
  office: Office;
  /** Lines worth showing the owner at startup. */
  notices: string[];
}

export const MINIMUM_NODE = 22;

export function checkNodeVersion(version: string = process.versions.node): string | undefined {
  const major = Number(version.split(".")[0]);
  if (Number.isNaN(major) || major >= MINIMUM_NODE) return undefined;
  return (
    `Staffroom needs Node ${MINIMUM_NODE} or newer and this is Node ${version}. ` +
    "Install the current version from nodejs.org, then run this again."
  );
}

export async function boot(options: BootOptions): Promise<BootResult> {
  const log = options.log ?? say;
  const notices: string[] = [];

  const nodeProblem = checkNodeVersion();
  if (nodeProblem !== undefined) throw new Error(nodeProblem);

  log(`Office folder: ${options.officeDir}`);

  /*
   * Brought forward before anything reads them.
   *
   * Here rather than in a command the owner has to know about: an office made
   * with an older Staffroom should open, not print an instruction. The rules
   * that make that safe — a backup first, the document edited rather than
   * rewritten, and nothing at all on the second run — live in migrate/index.ts.
   */
  const migrated = migrateOffice(options.officeDir);
  if (migrated.tooNew !== undefined) {
    // Thrown rather than logged: whoever started this prints the message, and
    // logging it here as well would say the same thing to the same person twice.
    throw new Error(migrateLines(migrated, false).join("\n"));
  }
  for (const step of migrated.applied) notices.push(`${step.file}: ${step.describe}`);
  for (const backup of migrated.backups) notices.push(`The file as it was is at ${backup}.`);

  // Demo is decided before the office is built, because it changes what providers
  // the office gets. A configured-but-broken provider never lands here.
  let office: Office;
  try {
    office = await createOffice({ officeDir: options.officeDir });
  } catch (error) {
    if (error instanceof ConfigInvalid) {
      log(printConfigErrors(error.errors));
      throw error;
    }
    throw error;
  }

  const wantsDemo = shouldUseDemo({
    providerCount: office.providers.size,
    ...(options.demo === undefined ? {} : { demoFlag: options.demo }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });

  if (wantsDemo) {
    const adapters = demoAdapters({
      officeDir: options.officeDir,
      ...(options.demoRunsDir === undefined ? {} : { demoRunsDir: options.demoRunsDir }),
    });
    office.close();
    office = await createOffice({ officeDir: options.officeDir, adapters, mode: "demo" });
  }

  for (const warning of office.warnings) {
    notices.push(`${warning.code}: ${warning.message}`);
  }
  for (const failure of office.toolFailures) {
    notices.push(`${failure.file} did not load: ${failure.message}`);
  }

  // Anything left waiting when the office last stopped cannot be answered now:
  // the run that asked is gone. Expire it so the resumed loop asks again.
  const pending = await office.store.pendingApprovals();
  for (const approval of pending) {
    await office.store.append(approval.runId, {
      type: "approval_resolved",
      approvalId: approval.approvalId,
      decision: "expired",
      by: "system",
      note: "server_restart",
    });
  }
  if (pending.length > 0) {
    notices.push(
      `${pending.length} approval${pending.length === 1 ? "" : "s"} expired while the office was closed.`,
    );
  }

  // A run marked running belongs to a process that no longer exists.
  const stranded = await office.store.list({ status: ["running", "waiting_approval"], limit: 100 });
  for (const run of stranded) {
    await office.store.append(run.id, {
      type: "failed",
      error: {
        code: "CANCELLED",
        message: "Stopped.",
        hint: "The office restarted while this was running. Ask again.",
        detail: {},
      },
      partialText: null,
      turns: 0,
    });
  }
  if (stranded.length > 0) {
    notices.push(
      `${stranded.length} unfinished run${stranded.length === 1 ? "" : "s"} were closed off.`,
    );
  }

  for (const notice of notices) log(notice);
  return { office, notices };
}
