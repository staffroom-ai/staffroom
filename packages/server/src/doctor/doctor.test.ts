/**
 * The doctor, against real office folders.
 *
 * The rule every check is held to here is that a failure says what to do, not
 * just that something is wrong. A diagnostic without a next step has moved the
 * problem rather than helped with it, so "has a hint" is asserted for all of them.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { type DoctorCheck, GITIGNORE_LINES, runDoctor } from "./index.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-doctor-"));
  made.push(dir);
  copyTemplate("studio", dir);
  return dir;
}

function find(checks: DoctorCheck[], id: string): DoctorCheck | undefined {
  return checks.find((c) => c.id === id);
}

describe("runDoctor", () => {
  it("passes a fresh office from the template", async () => {
    const result = await runDoctor({ officeDir: office() });
    expect(result.ok).toBe(true);
    expect(find(result.checks, "office.exists")?.status).toBe("ok");
    expect(find(result.checks, "agents.valid")?.status).toBe("ok");
  });

  /*
   * A new office should not be born warning.
   *
   * "passes a fresh office" above was green the whole time this was broken,
   * because `ok` is about failures and this was a warning. So every brand-new
   * office told its owner, on their first run, that their keys could end up in a
   * commit — over a .gitignore the product had just written itself. The template
   * listed `runs.sqlite` where the check wants `runs.sqlite*`, and SQLite's -wal
   * and -shm files sit right next to it.
   *
   * Asserted against GITIGNORE_LINES rather than against a copy of the list, so
   * the two cannot drift apart again.
   */
  it("writes a .gitignore its own doctor is happy with", async () => {
    const dir = office();
    const result = await runDoctor({ officeDir: dir });
    expect(find(result.checks, "office.gitignore")?.status).toBe("ok");

    const written = readFileSync(join(dir, ".gitignore"), "utf8").split(/\r?\n/);
    for (const line of GITIGNORE_LINES) expect(written).toContain(line);
  });

  it("says what to do when there is no office at all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-empty-"));
    made.push(dir);
    const result = await runDoctor({ officeDir: dir });
    expect(result.ok).toBe(false);
    expect(find(result.checks, "office.exists")?.hint).toContain("npx staffroom init");
  });

  it("stops after a missing office rather than piling on consequences", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-empty-"));
    made.push(dir);
    const result = await runDoctor({ officeDir: dir });
    expect(result.checks.filter((c) => c.status === "fail")).toHaveLength(1);
  });

  it("gives the NO_MODEL_CONFIGURED hint verbatim when nothing is configured", async () => {
    const result = await runDoctor({ officeDir: office() });
    const hints = result.checks.map((c) => c.hint ?? "").join(" ");
    expect(hints).toContain(
      "Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.",
    );
  });

  it("notices a .gitignore that would let secrets be committed", async () => {
    const dir = office();
    writeFileSync(join(dir, ".gitignore"), "# nothing useful\n", "utf8");
    const result = await runDoctor({ officeDir: dir });
    const check = find(result.checks, "office.gitignore");
    expect(check?.status).toBe("warn");
    expect(check?.hint).toContain("--fix");
  });

  it("--fix adds the missing lines and keeps what was there", async () => {
    const dir = office();
    writeFileSync(join(dir, ".gitignore"), "# mine\nnotes.txt\n", "utf8");
    const result = await runDoctor({ officeDir: dir, fix: true });

    const written = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(written).toContain("# mine");
    expect(written).toContain("notes.txt");
    for (const line of GITIGNORE_LINES) expect(written).toContain(line);
    expect(find(result.checks, "office.gitignore")?.fixed).toBe(true);
  });

  it("fails on a config.yaml that will not parse, and says where to look", async () => {
    const dir = office();
    writeFileSync(join(dir, "config.yaml"), "version: [unclosed\n", "utf8");
    const result = await runDoctor({ officeDir: dir });
    expect(result.ok).toBe(false);
    expect(find(result.checks, "config.valid")?.hint).toContain("office/config.yaml");
  });

  it("reports a tool file that will not compile without failing the office", async () => {
    const dir = office();
    mkdirSync(join(dir, "tools"), { recursive: true });
    writeFileSync(join(dir, "tools", "broken.ts"), "export const x = ((((\n");
    const result = await runDoctor({ officeDir: dir });
    const check = find(result.checks, "tools.custom");
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("broken.ts");
  });

  it("every check that is not ok says what to do about it", async () => {
    const dir = office();
    writeFileSync(join(dir, ".gitignore"), "", "utf8");
    const result = await runDoctor({ officeDir: dir });
    for (const check of result.checks) {
      if (check.status === "ok") continue;
      expect(check.hint, `${check.id} has no hint`).toBeDefined();
      expect((check.hint ?? "").length).toBeGreaterThan(0);
    }
  });

  it("notices a port already in use rather than failing to start later", async () => {
    const { createServer } = await import("node:net");
    const held = createServer();
    await new Promise<void>((done) => held.listen(0, "127.0.0.1", () => done()));
    const port = (held.address() as { port: number }).port;

    try {
      const result = await runDoctor({ officeDir: office(), port });
      expect(find(result.checks, "port")?.status).toBe("warn");
    } finally {
      await new Promise<void>((done) => held.close(() => done()));
    }
  });
});
