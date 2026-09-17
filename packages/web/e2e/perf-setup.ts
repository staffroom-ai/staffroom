/**
 * An office with 35 people in it, for the perf test to draw.
 *
 * The studio template has four, which is the office somebody actually opens and
 * therefore the wrong one to measure: four agents will look fine on a laptop
 * from 2015 and tell us nothing. Thirty-five is past any real small business and
 * comfortably past the point where a scene that draws one mesh per person per
 * frame starts to hurt — which is the failure this exists to catch, early,
 * rather than as a report that the office "feels slow" thirty commits later.
 *
 * Built from the shipped template rather than written from scratch, so the
 * thing under test is the real office with more people in it, not a synthetic
 * scene that happens to render.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "..", "..", "cli", "dist", "index.js");
const URL_LINE = /^\s*(http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]+)/m;
const DEADLINE_MS = 60_000;

export const PERF_HANDOFF = join(tmpdir(), "staffroom-perf-handoff.json");

/** How many people the scene has to draw. */
export const AGENTS = 35;

function run(args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: "ignore" });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${args[0]} exited ${code}`)),
    );
  });
}

/**
 * Adds people until there are 35, spread across the departments that exist.
 *
 * Edited as text rather than through the roster writer: this is a fixture, and
 * going through the office's own writer would make the fixture depend on the
 * thing it is setting up.
 */
function growRoster(officeDir: string): void {
  const path = join(officeDir, "agents.yaml");
  const text = readFileSync(path, "utf8");

  const departments = [...text.matchAll(/^\s+department:\s*(\S+)$/gm)].map((m) => m[1]);
  const already = departments.length;
  const rows: string[] = [];

  for (let i = already; i < AGENTS; i++) {
    const department = departments[i % departments.length];
    rows.push(
      [
        `  - id: extra-${i}`,
        `    department: ${department}`,
        `    name: Extra ${i}`,
        "    role: Assistant",
        "    does: Helps with whatever the department is doing.",
      ].join("\n"),
    );
  }

  writeFileSync(path, `${text.trimEnd()}\n${rows.join("\n")}\n`, "utf8");
}

async function perfSetup(): Promise<void> {
  const officeDir = mkdtempSync(join(tmpdir(), "staffroom-perf-"));
  await run(["init", "--template", "studio", "--dir", officeDir]);
  growRoster(officeDir);

  const child = spawn(
    process.execPath,
    [CLI, "demo", "--no-open", "--port", "0", "--office", officeDir],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const url = await new Promise<string>((done, fail) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new Error(
          `The office printed no URL within ${DEADLINE_MS / 1000}s.\n--- stdout ---\n${out}\n--- stderr ---\n${err}`,
        ),
      );
    }, DEADLINE_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = URL_LINE.exec(out);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`The office exited ${code} before printing a URL.\n${err}`));
    });
  });

  process.env["STAFFROOM_PERF_URL"] = url;
  writeFileSync(PERF_HANDOFF, JSON.stringify({ pid: child.pid, officeDir, url }), "utf8");
  child.unref();
}

export default perfSetup;
