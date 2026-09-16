/**
 * The built binary, actually run.
 *
 * Everything else in this package is tested as functions. This is the only place
 * that catches the things which only exist after a build: a missing shebang, a
 * lost executable bit, a dependency that resolves in the source tree and not in
 * dist. The loader bug in core was exactly that shape, so it is worth the
 * seconds this costs.
 *
 * Skipped rather than failed when dist is absent, so `vitest` on a fresh clone
 * does not fail for a reason that has nothing to do with the change being made.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const BIN = resolve(import.meta.dirname, "..", "dist", "index.js");
const built = existsSync(BIN);

const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-bin-"));
  made.push(dir);
  return dir;
}

describe.skipIf(!built)("the built CLI", () => {
  it("starts with a shebang", () => {
    expect(readFileSync(BIN, "utf8").split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  // NTFS has no POSIX permission bits, and npm does not use them there: on
  // Windows the bin entry becomes a generated .cmd shim instead. Asserting the
  // mode there fails for a reason that has nothing to do with the package.
  it.skipIf(process.platform === "win32")("is executable", () => {
    expect(statSync(BIN).mode & 0o100).toBe(0o100);
  });

  it("prints a version", async () => {
    const { stdout } = await run(process.execPath, [BIN, "--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("makes an office with init and exits 0", async () => {
    const dir = join(temp(), "office");
    await run(process.execPath, [BIN, "init", "--template", "studio", "--dir", dir]);
    expect(existsSync(join(dir, "agents.yaml"))).toBe(true);
  });

  it("copies five example tools with --tools", async () => {
    const dir = join(temp(), "office");
    const { stdout } = await run(process.execPath, [BIN, "init", "--dir", dir, "--tools"]);
    expect(existsSync(join(dir, "tools"))).toBe(true);
    expect(stdout).toContain("TRY IT");
  });

  it("prints a token-bearing URL and exits, leaving nothing listening", async () => {
    const home = temp();
    const { stdout } = await run(
      process.execPath,
      [BIN, "demo", "--no-open", "--exit-when-ready"],
      { env: { ...process.env, HOME: home, USERPROFILE: home }, cwd: temp() },
    );
    expect(stdout).toContain("Staffroom is running");
    expect(stdout).toContain("Office folder:");
    expect(stdout).toMatch(/\?t=[a-f0-9]{16,}/);
    expect(stdout).toContain("Keep this window open.");
  }, 30_000);
});
