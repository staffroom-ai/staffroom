/**
 * Checking an office over, and saying what to do about what it finds.
 *
 * This lives in the server rather than the CLI because the office needs to be
 * able to run the same checks itself and show them in the browser; the CLI
 * depends on the server, never the other way round.
 *
 * Every check follows one rule: a failure says what is wrong AND what to do. A
 * diagnostic that only tells you something is broken has moved the problem, not
 * helped with it.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  ConfigInvalid,
  loadAgentsFile,
  loadConfig,
  printConfigErrors,
  Telemetry,
} from "@staffroom/core";
import { checkNodeVersion } from "../boot.js";

/**
 * Repeated rather than imported from the package index, which imports this
 * module: a cycle for one string would be a poor trade. The version-constants
 * lint gate keeps it honest.
 */
const SERVER_VERSION = "0.2.0";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  hint?: string;
  /** Set when --fix actually changed something. */
  fixed?: boolean;
}

export interface DoctorOptions {
  officeDir: string;
  fix?: boolean;
  /** Overridden in tests so a check does not depend on a real free port. */
  port?: number;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ok: boolean;
}

/** The lines an office's .gitignore needs so secrets and databases stay put. */
export const GITIGNORE_LINES = [".env", "runs.sqlite*", "brain.index.sqlite*", ".staffroom/"];

// A passing check can still have something worth saying — how to turn a thing
// off, most often. That is not a warning, so it does not become one.
const ok = (id: string, message: string, hint?: string): DoctorCheck => ({
  id,
  status: "ok",
  message,
  ...(hint === undefined ? {} : { hint }),
});
const warn = (id: string, message: string, hint?: string): DoctorCheck => ({
  id,
  status: "warn",
  message,
  ...(hint === undefined ? {} : { hint }),
});
const fail = (id: string, message: string, hint?: string): DoctorCheck => ({
  id,
  status: "fail",
  message,
  ...(hint === undefined ? {} : { hint }),
});

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function checkGitignore(officeDir: string, fix: boolean): DoctorCheck {
  const path = join(officeDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const missing = GITIGNORE_LINES.filter(
    (line) => !existing.split(/\r?\n/).some((l) => l.trim() === line),
  );

  if (missing.length === 0) return ok("office.gitignore", "Secrets and databases are ignored.");

  if (fix) {
    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    writeFileSync(path, `${existing}${separator}${missing.join("\n")}\n`, "utf8");
    return {
      id: "office.gitignore",
      status: "ok",
      message: `Added ${missing.join(", ")} to .gitignore.`,
      fixed: true,
    };
  }

  return warn(
    "office.gitignore",
    `.gitignore is missing ${missing.join(", ")}.`,
    "Run npx staffroom doctor --fix to add them, or your keys could end up in a commit.",
  );
}

/**
 * The telemetry payload, printed whole.
 *
 * Built from the office's own numbers where they can be read, so what it shows
 * is this office rather than an example. A config that will not parse falls back
 * to zeros: the point is the shape and the absence of anything identifying, and
 * that is visible either way.
 */
async function telemetryCheck(officeDir: string): Promise<DoctorCheck> {
  let enabled = false;
  let providers: string[] = [];
  let agentCount = 0;
  const custom = 0;
  let mcp = 0;

  try {
    const loaded = loadConfig(officeDir);
    enabled = loaded.config.telemetry.enabled;
    providers = Object.keys(loaded.config.providers);
    mcp = Object.keys(loaded.config.mcp.servers).length;
    agentCount = loadAgentsFile(officeDir).agents.length;
  } catch {
    // Reported properly by the config checks above; this one still answers.
  }

  const telemetry = new Telemetry({
    officeDir,
    // Built, never recorded, so nothing is queued and no id file is written by
    // somebody merely asking what would be sent.
    enabled: false,
    version: SERVER_VERSION,
    mode: "live",
    providers,
    agentCount,
    toolSources: { mcp, custom },
  });

  const payload = JSON.stringify(
    telemetry.build("run_done", {
      runDurationMs: 4_200,
      runOutcome: "done",
      approvalUsed: false,
    }),
  );

  if (!enabled) {
    return ok(
      "telemetry",
      `Off. Nothing is sent. If you turned it on, one event per start and per finished run would look like: ${payload}`,
    );
  }

  return ok(
    "telemetry",
    `On, batched every ten minutes. A finished run looks like: ${payload}`,
    "Set telemetry.enabled to false in office/config.yaml to turn it off, or STAFFROOM_TELEMETRY=0 for this machine.",
  );
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const { officeDir } = options;
  const fix = options.fix === true;
  const checks: DoctorCheck[] = [];

  const nodeProblem = checkNodeVersion();
  checks.push(
    nodeProblem === undefined
      ? ok("node.version", `Node ${process.versions.node}.`)
      : fail("node.version", nodeProblem),
  );

  checks.push(ok("office.path", officeDir));

  const exists = existsSync(join(officeDir, "agents.yaml"));
  checks.push(
    exists
      ? ok("office.exists", "The office folder is there.")
      : fail("office.exists", `No office at ${officeDir}.`, "Run npx staffroom init to make one."),
  );

  // Everything below reads the office. Without one there is nothing to say, and
  // a wall of consequential failures would bury the one that matters.
  if (!exists) return { checks, ok: false };

  checks.push(checkGitignore(officeDir, fix));

  let providerNames: string[] = [];
  try {
    const loaded = loadConfig(officeDir);
    checks.push(ok("config.valid", "config.yaml reads cleanly."));

    providerNames = Object.keys(loaded.config.providers ?? {});
    checks.push(
      providerNames.length === 0
        ? warn(
            "providers",
            "No providers are configured.",
            "Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.",
          )
        : ok("providers", `Configured: ${providerNames.join(", ")}.`),
    );

    for (const { path, name } of loaded.unresolved) {
      checks.push(
        warn(
          `providers.${path}`,
          `${path} wants ${name}, which is not set.`,
          `Add ${name} to office/.env, or paste the key in Settings > Models.`,
        ),
      );
    }

    checks.push(
      loaded.secrets.length > 0
        ? ok("config.secrets", `${loaded.secrets.length} secret(s) resolved from .env.`)
        : warn(
            "config.secrets",
            "No secrets resolved, so the office will replay recorded work.",
            "Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.",
          ),
    );
  } catch (error) {
    checks.push(
      fail(
        "config.valid",
        error instanceof ConfigInvalid ? printConfigErrors(error.errors) : String(error),
        "Fix office/config.yaml and run this again.",
      ),
    );
  }

  try {
    const agents = loadAgentsFile(officeDir);
    const count = agents.agents.length;
    checks.push(
      count > 0
        ? ok("agents.valid", `${count} member(s) of staff.`)
        : warn("agents.valid", "The roster is empty.", "Add someone to office/agents.yaml."),
    );
  } catch (error) {
    checks.push(
      fail(
        "agents.valid",
        error instanceof ConfigInvalid ? printConfigErrors(error.errors) : String(error),
        "Fix office/agents.yaml and run this again.",
      ),
    );
  }

  for (const [id, file] of [
    ["runs.db", "runs.sqlite"],
    ["brain.index", "brain.index.sqlite"],
  ] as const) {
    const path = join(officeDir, file);
    if (!existsSync(path)) {
      checks.push(
        warn(
          id,
          `${file} has not been created yet.`,
          "It is written the first time the office opens.",
        ),
      );
      continue;
    }
    try {
      checks.push(ok(id, `${file}, ${Math.max(1, Math.round(statSync(path).size / 1024))} KB.`));
    } catch {
      checks.push(fail(id, `${file} could not be read.`, "Check the folder's permissions."));
    }
  }

  const toolsDir = join(officeDir, "tools");
  if (existsSync(toolsDir)) {
    const { loadCustomTools } = await import("@staffroom/core");
    const result = await loadCustomTools({ dir: toolsDir });
    for (const failure of result.failures) {
      checks.push(
        fail(
          "tools.custom",
          `${failure.file} could not be loaded. ${failure.message}`,
          "Fix the file; the office keeps running without it.",
        ),
      );
    }
    if (result.failures.length === 0) {
      checks.push(ok("tools.custom", `${result.tools.length} tool(s) of your own.`));
    }
  }

  /*
   * SR-071: what would be sent, in full, rather than a promise that it is fine.
   *
   * "Telemetry is anonymous" is a claim, and a claim about somebody's business
   * data is worth exactly as much as their ability to check it. So this prints
   * the actual payload — the same object the sender would post — and when it is
   * off it prints the one it would send if it were on, because the question
   * people want answered before turning it on is what it would say about them.
   */
  checks.push(await telemetryCheck(officeDir));

  const port = options.port ?? 4242;
  checks.push(
    (await portIsFree(port))
      ? ok("port", `Port ${port} is free.`)
      : warn(
          "port",
          `Port ${port} is in use.`,
          "The office will pick the next free port, or pass --port.",
        ),
  );

  return { checks, ok: !checks.some((c) => c.status === "fail") };
}
