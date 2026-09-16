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
import { ConfigInvalid, loadAgentsFile, loadConfig, printConfigErrors } from "@staffroom/core";
import { checkNodeVersion } from "../boot.js";

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

const ok = (id: string, message: string): DoctorCheck => ({ id, status: "ok", message });
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
