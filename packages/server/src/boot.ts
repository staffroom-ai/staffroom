/**
 * Starting an office.
 *
 * Every step that can fail prints something the owner can act on, and the ones
 * that can degrade do rather than refusing to start. The exception is a config
 * file that will not parse: an office running on a roster the owner did not write
 * is worse than one that will not start and says why.
 */
import {
  ConfigInvalid,
  checkForUpdate,
  createOffice,
  type Office,
  printConfigErrors,
  Telemetry,
} from "@staffroom/core";
import { demoAdapters, shouldUseDemo } from "./demo/demo.js";
import { say } from "./log.js";
import { migrateLines, migrateOffice } from "./migrate/index.js";

export interface BootOptions {
  officeDir: string;
  /** What to report as this build's version, and what to compare against npm. */
  version?: string;
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
  /** Off unless the office asked for it. Close it to flush what is queued. */
  telemetry: Telemetry;
  /**
   * Points the office's connector-change callback at something.
   *
   * The office is built before the socket hub exists, so the caller wires this
   * once it has one. Without it the connector strip kept the snapshot it had at
   * boot, where nothing has answered yet and every server reads "starting".
   */
  whenMcpChanges: (fn: () => void) => void;
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
  /*
   * The office is built before the socket hub exists, so what it calls when a
   * connector's health changes is filled in afterwards. Without it the strip
   * showed whatever was true at boot — "starting" for everything, because
   * nothing has answered a millisecond in — for the rest of the session.
   */
  let onMcpChange: () => void = () => {};
  const mcpChanged = (): void => onMcpChange();

  let office: Office;
  try {
    office = await createOffice({ officeDir: options.officeDir, onMcpChange: mcpChanged });
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
    office = await createOffice({
      officeDir: options.officeDir,
      adapters,
      mode: "demo",
      onMcpChange: mcpChanged,
    });
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

  /*
   * SR-071: counts, and the once-a-day update line. Both off unless asked for.
   *
   * Built here rather than in createServer so an office opened with --no-watch,
   * or by a test, gets the same answer: off is off everywhere, and there is one
   * place to read to find out why.
   */
  const telemetry = new Telemetry({
    officeDir: options.officeDir,
    enabled: office.config.telemetry.enabled,
    endpoint: office.config.telemetry.endpoint,
    version: options.version ?? "0.0.0",
    mode: office.mode,
    providers: [...office.providers.keys()].filter((kind) => kind !== "demo"),
    agentCount: office.agentsFile.agents.length,
    toolSources: {
      mcp: office.mcp.status().length,
      custom: office.toolFailures.length + office.tools.list().length,
    },
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  telemetry.record("start");

  // Awaited, because the line is only useful before the banner. It returns
  // immediately without a request in every case except one check a day.
  //
  // Gated on `telemetry.on` rather than on the config flag, so demo mode is
  // covered by the same rule everything else is. Found by running it: with the
  // flag on and no provider configured, telemetry correctly stayed silent and
  // the update check reached npm anyway — which makes "demo mode never sends
  // anything" false, and that sentence is one somebody decides to trust this on
  // the strength of.
  const update = await checkForUpdate({
    current: options.version ?? "0.0.0",
    telemetryEnabled: telemetry.on,
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  if (update !== undefined) notices.push(update);

  for (const notice of notices) log(notice);
  // Handed back so the caller can point it at the hub once there is one.
  return {
    office,
    notices,
    telemetry,
    whenMcpChanges: (fn: () => void) => {
      onMcpChange = fn;
    },
  };
}
