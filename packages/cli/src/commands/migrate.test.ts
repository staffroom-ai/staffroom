/**
 * `staffroom migrate`, as somebody actually runs it.
 *
 * The module underneath is tested in the server package. What matters here is
 * what a person sees in a terminal: a dry run that says what would change and
 * leaves the file alone, and a file from the future that says the one thing
 * that helps rather than a stack trace.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateCommand } from "./migrate.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const V1 = "version: 1\nproviders: {}\napprovals:\n  expiry_hours: 24   # a comment\n";

function office(config = V1): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-migratecmd-"));
  dirs.push(dir);
  writeFileSync(join(dir, "config.yaml"), config, "utf8");
  return dir;
}

const configOf = (dir: string): string => readFileSync(join(dir, "config.yaml"), "utf8");

describe("staffroom migrate", () => {
  it("brings an old office forward and says where the old file is", () => {
    const dir = office();
    const lines: string[] = [];

    const result = migrateCommand({ officeDir: dir }, (line) => lines.push(line));

    expect(result.changed).toBe(1);
    expect(result.tooNew).toBe(false);
    expect(configOf(dir)).toContain("whitelist_days: 90");
    // Somebody who did not expect this needs to know there is a way back.
    expect(lines.join(" ")).toContain(".staffroom");
    expect(lines.join(" ")).toContain("as it was");
  });

  it("keeps the owner's comments, which is the point of the whole approach", () => {
    const dir = office();
    migrateCommand({ officeDir: dir }, () => {});
    expect(configOf(dir)).toContain("# a comment");
  });

  it("writes nothing on a dry run, and says so", () => {
    const dir = office();
    const before = configOf(dir);
    const lines: string[] = [];

    const result = migrateCommand({ officeDir: dir, dryRun: true }, (line) => lines.push(line));

    expect(result.changed).toBe(1);
    expect(configOf(dir)).toBe(before);
    expect(lines.join(" ")).toContain("Nothing was written");
  });

  it("says plainly when there is nothing to do", () => {
    const dir = office("version: 2\napprovals:\n  whitelist_days: 90\n");
    const lines: string[] = [];

    const result = migrateCommand({ officeDir: dir }, (line) => lines.push(line));

    expect(result.changed).toBe(0);
    expect(lines.join(" ")).toContain("already up to date");
  });

  it("reports a file from the future so a script can act on it", () => {
    const dir = office("version: 99\nproviders: {}\n");
    const lines: string[] = [];

    const result = migrateCommand({ officeDir: dir }, (line) => lines.push(line));

    // The exit code is set from this, because there is nothing the command can
    // do about it and whatever is scripting the update needs to stop.
    expect(result.tooNew).toBe(true);
    expect(lines.join(" ")).toContain("Update Staffroom");
  });

  it("refuses a folder that is not there, by name", () => {
    expect(() => migrateCommand({ officeDir: join(tmpdir(), "staffroom-no-such-office") })).toThrow(
      /no folder at/,
    );
  });
});
