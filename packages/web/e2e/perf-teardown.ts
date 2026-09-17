/**
 * Stopping the office the perf test used, and leaving nothing behind.
 *
 * CI asserts with `ps` that no node process survives this, because a stray
 * server holding a port is the kind of thing that makes the next run fail for a
 * reason that has nothing to do with the change.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { PERF_HANDOFF } from "./perf-setup.js";

const GRACE_MS = 5_000;

async function perfTeardown(): Promise<void> {
  if (!existsSync(PERF_HANDOFF)) return;
  const { pid, officeDir } = JSON.parse(readFileSync(PERF_HANDOFF, "utf8")) as {
    pid: number;
    officeDir: string;
  };

  const alive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }

  // Ask, wait, then insist.
  const until = Date.now() + GRACE_MS;
  while (Date.now() < until && alive()) {
    await new Promise((done) => setTimeout(done, 100));
  }
  if (alive()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Raced with its own exit.
    }
  }

  rmSync(officeDir, { recursive: true, force: true });
  rmSync(PERF_HANDOFF, { force: true });
}

export default perfTeardown;
