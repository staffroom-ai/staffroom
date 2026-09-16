/**
 * `brain import` and `brain reindex` as somebody actually runs them.
 *
 * The acceptance case for reindex is the one that matters: a deleted index has
 * to come back. The index is a cache of the files and never the other way
 * round, so losing it should cost a minute and nothing else — if it cost an
 * office, the whole "your notes are just files" promise would be untrue.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyTemplate } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { importIntoBrain, reindexBrain } from "./brain.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-braincmd-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  return dir;
}

function source(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-braincmd-src-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

const indexOf = (officeDir: string): string => join(officeDir, "brain.index.sqlite");

describe("brain import", () => {
  it("brings the notes in and says what it did", () => {
    const officeDir = office();
    const lines: string[] = [];

    const summary = importIntoBrain(
      { officeDir, source: source({ "a.md": "See [[b]].", "b.md": "Here." }) },
      (line) => lines.push(line),
    );

    expect(summary.notes).toBe(2);
    expect(summary.linksResolved).toBe(1);
    expect(existsSync(join(officeDir, "brain", "90-archive", "a.md"))).toBe(true);
    expect(lines.join(" ")).toContain("2 notes");
  });

  it("tells the owner where the files are, because that is the whole promise", () => {
    const officeDir = office();
    const lines: string[] = [];
    importIntoBrain({ officeDir, source: source({ "a.md": "x" }) }, (line) => lines.push(line));

    expect(lines.join(" ")).toContain("markdown files");
    expect(lines.join(" ")).toContain(join(officeDir, "brain"));
  });

  it("refuses a folder that is not there, by name", () => {
    const officeDir = office();
    expect(() =>
      importIntoBrain({ officeDir, source: join(officeDir, "nowhere") }, () => {}),
    ).toThrow(/no folder at/);
  });

  it("refuses to import the brain into itself", () => {
    // It would walk the folder it is writing into, and never finish.
    const officeDir = office();
    expect(() =>
      importIntoBrain({ officeDir, source: join(officeDir, "brain") }, () => {}),
    ).toThrow(/already inside/);
  });

  it("lands somewhere else when asked", () => {
    const officeDir = office();
    importIntoBrain({ officeDir, source: source({ "a.md": "x" }), area: "10-customers" }, () => {});
    expect(existsSync(join(officeDir, "brain", "10-customers", "a.md"))).toBe(true);
  });

  it("does not bring a tools folder, and says so", () => {
    const officeDir = office();
    const lines: string[] = [];

    importIntoBrain(
      { officeDir, source: source({ "a.md": "x", "tools/thing.ts": "export default 1" }) },
      (line) => lines.push(line),
    );

    // Those files run on this machine; bringing them in quietly is not on.
    expect(existsSync(join(officeDir, "brain", "90-archive", "thing.ts"))).toBe(false);
    expect(lines.join(" ")).toContain("--include-tools");
  });
});

describe("brain reindex", () => {
  it("recreates an index that was deleted", () => {
    const officeDir = office();

    // Build one, then throw it away, which is the case somebody runs this for.
    reindexBrain({ officeDir }, () => {});
    expect(existsSync(indexOf(officeDir))).toBe(true);
    rmSync(indexOf(officeDir), { force: true });
    expect(existsSync(indexOf(officeDir))).toBe(false);

    const lines: string[] = [];
    const result = reindexBrain({ officeDir }, (line) => lines.push(line));

    expect(existsSync(indexOf(officeDir))).toBe(true);
    expect(result.notes).toBeGreaterThan(0);
    expect(lines.join(" ")).toContain("notes");
  });

  it("prints a warning per note rather than a count", () => {
    const officeDir = office();
    // Front matter that will not parse. The note is indexed anyway; the owner
    // is the only one who can fix it, and they need the filename to do it.
    writeFileSync(
      join(officeDir, "brain", "00-about", "broken.md"),
      "---\ntitle: [unclosed\n---\n\nSome text.\n",
      "utf8",
    );

    const lines: string[] = [];
    const result = reindexBrain({ officeDir }, (line) => lines.push(line));

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toContain("broken");
    expect(lines.join(" ")).toContain("indexed anyway");
  });

  it("picks up a note added by hand, which is why this exists", () => {
    const officeDir = office();
    const before = reindexBrain({ officeDir }, () => {}).notes;

    writeFileSync(
      join(officeDir, "brain", "00-about", "by-hand.md"),
      "---\ntitle: By hand\ncreated: 2026-01-01T00:00:00+11:00\n---\n\nTyped straight into the folder.\n",
      "utf8",
    );

    expect(reindexBrain({ officeDir }, () => {}).notes).toBe(before + 1);
  });

  it("says plainly that embeddings are not in this version", () => {
    const officeDir = office();
    const lines: string[] = [];
    reindexBrain({ officeDir, embeddings: true }, (line) => lines.push(line));

    // Accepting the flag and ignoring it in silence would be the office
    // pretending to do something it cannot.
    expect(lines.join(" ")).toContain("not in this version");
  });

  it("refuses an office with no brain folder, by name", () => {
    const officeDir = office();
    rmSync(join(officeDir, "brain"), { recursive: true, force: true });
    expect(() => reindexBrain({ officeDir }, () => {})).toThrow(/no brain folder/);
  });
});

describe("import then reindex", () => {
  it("finds the imported notes, and their text is searchable", () => {
    const officeDir = office();
    importIntoBrain(
      {
        officeDir,
        source: source({
          "kiln.md": "---\ntitle: Kiln notes\n---\n\nThe kiln runs at 240 degrees.\n",
        }),
      },
      () => {},
    );

    const result = reindexBrain({ officeDir }, () => {});
    expect(result.notes).toBeGreaterThan(0);

    const written = readFileSync(join(officeDir, "brain", "90-archive", "kiln.md"), "utf8");
    expect(written).toContain("240 degrees");
    expect(written).toContain("title: Kiln notes");
  });
});
