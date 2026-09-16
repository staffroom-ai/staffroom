/**
 * Starting a real office for the smoke test to drive.
 *
 * Playwright's `webServer` option cannot do this: the URL carries a per-boot
 * token it has no way to know, and with `--port 0` the port is not decided until
 * the server is already up. So the office is started here and the URL is read out
 * of its own stdout, which is also the closest thing to what a real user does.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "..", "..", "cli", "dist", "index.js");
const URL_LINE = /^\s*(http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]+)/m;
const DEADLINE_MS = 30_000;

export const HANDOFF = join(tmpdir(), "staffroom-e2e-handoff.json");

async function globalSetup(): Promise<void> {
  const officeDir = mkdtempSync(join(tmpdir(), "staffroom-e2e-"));

  // Make the office first and let it finish, so the office the server opens is
  // never half-written.
  await new Promise<void>((done, fail) => {
    const init = spawn(
      process.execPath,
      [CLI, "init", "--template", "studio", "--dir", officeDir],
      {
        stdio: "ignore",
      },
    );
    init.on("error", fail);
    init.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`staffroom init exited ${code}`)),
    );
  });

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
      // The child's own stderr is the only thing that explains this, so it is
      // reported rather than a bare timeout.
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

  process.env["STAFFROOM_URL"] = url;
  writeFileSync(HANDOFF, JSON.stringify({ pid: child.pid, officeDir, url }), "utf8");
  child.unref();
}

export default globalSetup;
