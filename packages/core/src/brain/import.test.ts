/**
 * Bringing somebody's notes in without breaking them.
 *
 * The acceptance case is a fifty-note Obsidian vault whose every internal link
 * resolves, and the point of it is the thing an owner would notice within a
 * minute: a vault that worked before must still work after. Half the links
 * pointing nowhere is worse than a failed import, because a failed import is
 * obvious and a half-broken one is not.
 *
 * The other rules here are about not losing anything: nothing overwritten,
 * nothing pinned, nothing claimed to be written by an agent, and a link that
 * could not be resolved left exactly as the owner typed it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATTACHMENTS,
  DEFAULT_AREA,
  fillFrontMatter,
  importBrain,
  isObsidianVault,
  slugOf,
  summaryLines,
  walk,
} from "./import.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A folder on disk, because this copies real files. */
function source(files: Record<string, string>): string {
  const dir = tempDir("staffroom-import-src-");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

const brain = (): string => tempDir("staffroom-import-brain-");

const read = (brainDir: string, name: string): string =>
  readFileSync(join(brainDir, DEFAULT_AREA, name), "utf8");

describe("recognising a vault", () => {
  it("knows one by its settings folder", () => {
    expect(isObsidianVault(source({ ".obsidian/app.json": "{}", "a.md": "x" }))).toBe(true);
  });

  it("does not mistake a plain folder for one", () => {
    expect(isObsidianVault(source({ "a.md": "x" }))).toBe(false);
  });
});

describe("what is walked", () => {
  it("finds notes at any depth", () => {
    const { files } = walk(source({ "a.md": "x", "deep/down/b.md": "y" }));
    expect(files.map((f) => f.rel).sort()).toEqual(["a.md", "deep/down/b.md"]);
  });

  it("leaves a tools folder alone unless asked, and says why", () => {
    // Those files run on this machine. Copying them in because they happened to
    // be in the folder is not something to do quietly.
    const dir = source({ "a.md": "x", "tools/evil.ts": "export default 1" });
    const { files, skipped } = walk(dir);

    expect(files.map((f) => f.rel)).toEqual(["a.md"]);
    expect(skipped.find((s) => s.path === "tools")?.reason).toContain("not imported unless asked");
  });

  it("brings the tools folder when it is asked", () => {
    const dir = source({ "a.md": "x", "tools/mine.ts": "export default 1" });
    const { files } = walk(dir, { includeTools: true });
    expect(files.map((f) => f.rel)).toContain("tools/mine.ts");
  });

  it("skips the machinery nobody wants in their notes", () => {
    const dir = source({
      "a.md": "x",
      "node_modules/pkg/index.js": "1",
      "package.json": "{}",
      ".hidden/secret": "1",
    });
    const { files } = walk(dir);
    expect(files.map((f) => f.rel)).toEqual(["a.md"]);
  });
});

describe("importing a plain folder", () => {
  it("lands the notes in the archive, which is half weight and never pinned", () => {
    const brainDir = brain();
    const summary = importBrain(source({ "Meeting Notes.md": "# Notes\n\nHello.\n" }), brainDir);

    expect(summary.notes).toBe(1);
    expect(existsSync(join(brainDir, DEFAULT_AREA, "meeting-notes.md"))).toBe(true);
  });

  it("copies rather than moves, so somebody can change their mind", () => {
    const src = source({ "a.md": "x" });
    importBrain(src, brain());
    expect(existsSync(join(src, "a.md"))).toBe(true);
  });

  it("moves when it is told to", () => {
    const src = source({ "a.md": "x" });
    importBrain(src, brain(), { move: true });
    expect(existsSync(join(src, "a.md"))).toBe(false);
  });

  it("lands somewhere else when told", () => {
    const brainDir = brain();
    importBrain(source({ "a.md": "x" }), brainDir, { area: "10-customers" });
    expect(existsSync(join(brainDir, "10-customers", "a.md"))).toBe(true);
  });

  it("never lands on a note that is already there", () => {
    const brainDir = brain();
    importBrain(source({ "notes.md": "the first one" }), brainDir);
    importBrain(source({ "notes.md": "the second one" }), brainDir);

    // Two notes called notes.md are two notes, and losing one silently is
    // losing somebody's writing.
    expect(read(brainDir, "notes.md")).toContain("the first one");
    expect(read(brainDir, "notes-2.md")).toContain("the second one");
  });
});

describe("front matter", () => {
  it("fills in what is missing and nothing else", () => {
    const out = fillFrontMatter("---\ntags: [a, b]\n---\n\nBody.\n", {
      title: "A note",
      created: "2026-01-01T00:00:00.000Z",
    });

    // The owner's own keys survive untouched.
    expect(out).toContain("tags: [a, b]");
    expect(out).toContain('title: "A note"');
    expect(out).toContain("written_by: owner");
  });

  it("does not overwrite a title the owner wrote", () => {
    const out = fillFrontMatter("---\ntitle: Theirs\n---\n\nBody.\n", {
      title: "Ours",
      created: "2026-01-01T00:00:00.000Z",
    });

    expect(out).toContain("title: Theirs");
    expect(out).not.toContain("Ours");
  });

  it("adds front matter to a note that had none", () => {
    const out = fillFrontMatter("Just text.\n", {
      title: "Plain",
      created: "2026-01-01T00:00:00.000Z",
    });

    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("Just text.");
  });

  it("says the owner wrote it, never an agent", () => {
    const brainDir = brain();
    importBrain(source({ "a.md": "text" }), brainDir);
    // Nothing here claims an agent wrote something a person did.
    expect(read(brainDir, "a.md")).toContain("written_by: owner");
  });

  it("pins nothing", () => {
    const brainDir = brain();
    importBrain(source({ "a.md": "text" }), brainDir);
    // Pinned notes go into every prompt every agent sees. Five hundred imported
    // notes must not make that decision for the owner.
    expect(read(brainDir, "a.md")).not.toContain("pinned");
  });
});

describe("links", () => {
  it("keeps a wiki-link working by pointing it at where the note went", () => {
    const brainDir = brain();
    const summary = importBrain(
      source({ "one.md": "See [[two]] for more.", "two.md": "The other one." }),
      brainDir,
    );

    expect(summary.linksResolved).toBe(1);
    expect(read(brainDir, "one.md")).toContain(`[[${DEFAULT_AREA}/two]]`);
  });

  it("keeps a heading or an alias on the end of one", () => {
    const brainDir = brain();
    importBrain(source({ "one.md": "See [[two#Pricing|the prices]].", "two.md": "x" }), brainDir);

    const text = read(brainDir, "one.md");
    expect(text).toContain("#Pricing|the prices");
  });

  it("resolves a link written as a path", () => {
    const brainDir = brain();
    const summary = importBrain(
      source({ "a.md": "See [[folder/two]].", "folder/two.md": "x" }),
      brainDir,
    );
    expect(summary.linksResolved).toBe(1);
  });

  it("leaves a link to something that did not come, exactly as it was", () => {
    const brainDir = brain();
    const summary = importBrain(source({ "one.md": "See [[missing]]." }), brainDir);

    // Rewriting it to something that does exist would be the import guessing at
    // what the owner meant.
    expect(read(brainDir, "one.md")).toContain("[[missing]]");
    expect(summary.linksUnresolved).toContain("missing");
  });
});

describe("attachments", () => {
  it("copies a picture a note embeds, and points the note at it", () => {
    const brainDir = brain();
    const summary = importBrain(
      source({ "a.md": "![[diagram.png]]", "images/diagram.png": "PNG" }),
      brainDir,
    );

    expect(summary.attachments).toBe(1);
    expect(existsSync(join(brainDir, ATTACHMENTS, "diagram.png"))).toBe(true);
    expect(read(brainDir, "a.md")).toContain(`${ATTACHMENTS}/diagram.png`);
  });

  it("writes a path that resolves from where the note actually sits", () => {
    // The note lands in an area folder and the picture at the top of the brain,
    // so a bare `_attachments/x.png` points at a file that is not there. This
    // is the kind of break nobody notices until they open the note months on.
    const brainDir = brain();
    importBrain(source({ "a.md": "![[diagram.png]]", "images/diagram.png": "PNG" }), brainDir);

    const note = read(brainDir, "a.md");
    const href = /!\[[^\]]*\]\(([^)]+)\)/.exec(note)?.[1];
    expect(href).toBeDefined();
    expect(existsSync(resolve(join(brainDir, DEFAULT_AREA), href as string))).toBe(true);
  });

  it("counts deeper areas, so a nested --area still reaches the pictures", () => {
    const brainDir = brain();
    importBrain(source({ "a.md": "![[diagram.png]]", "images/diagram.png": "PNG" }), brainDir, {
      area: "10-customers/acme",
    });

    const note = readFileSync(join(brainDir, "10-customers", "acme", "a.md"), "utf8");
    const href = /!\[[^\]]*\]\(([^)]+)\)/.exec(note)?.[1];
    expect(existsSync(resolve(join(brainDir, "10-customers", "acme"), href as string))).toBe(true);
  });

  it("handles a markdown image as well as an embed", () => {
    const brainDir = brain();
    importBrain(source({ "a.md": "![alt](images/shot.png)", "images/shot.png": "PNG" }), brainDir);
    expect(read(brainDir, "a.md")).toContain(`![alt](../${ATTACHMENTS}/shot.png)`);
  });

  it("leaves a link to the web alone", () => {
    const brainDir = brain();
    importBrain(source({ "a.md": "![x](https://example.com/a.png)" }), brainDir);
    expect(read(brainDir, "a.md")).toContain("https://example.com/a.png");
  });

  it("copies only what something points at", () => {
    const brainDir = brain();
    const summary = importBrain(
      source({ "a.md": "![[used.png]]", "used.png": "PNG", "unused.png": "PNG" }),
      brainDir,
    );

    // A vault's image folder is years of screenshots nothing refers to.
    expect(summary.attachments).toBe(1);
    expect(existsSync(join(brainDir, ATTACHMENTS, "unused.png"))).toBe(false);
  });
});

describe("a fifty-note Obsidian vault", () => {
  /** Fifty notes in a ring, each linking to the next, plus embedded images. */
  function vault(): string {
    const files: Record<string, string> = { ".obsidian/app.json": "{}" };

    for (let i = 0; i < 50; i++) {
      const next = (i + 1) % 50;
      files[`notes/note-${i}.md`] = [
        `# Note ${i}`,
        "",
        `Follows on from [[note-${next}]].`,
        i % 10 === 0 ? `![[figure-${i}.png]]` : "",
        i % 7 === 0 ? `Also [[note-${(i + 13) % 50}#Detail|the detail]].` : "",
      ].join("\n");

      if (i % 10 === 0) files[`assets/figure-${i}.png`] = "PNG";
    }

    return source(files);
  }

  it("resolves every internal link", () => {
    const brainDir = brain();
    const summary = importBrain(vault(), brainDir);

    expect(summary.obsidian).toBe(true);
    expect(summary.notes).toBe(50);
    // The acceptance criterion: every one, not most.
    expect(summary.linksUnresolved).toEqual([]);
    expect(summary.linksResolved).toBeGreaterThanOrEqual(50);
  });

  it("copies its images", () => {
    const brainDir = brain();
    const summary = importBrain(vault(), brainDir);

    expect(summary.attachments).toBe(5);
    for (const i of [0, 10, 20, 30, 40]) {
      expect(existsSync(join(brainDir, ATTACHMENTS, `figure-${i}.png`))).toBe(true);
    }
  });

  it("leaves every note readable, with its links pointing into the brain", () => {
    const brainDir = brain();
    importBrain(vault(), brainDir);

    const first = read(brainDir, "note-0.md");
    expect(first).toContain(`[[${DEFAULT_AREA}/note-1]]`);
    expect(first).toContain(`${ATTACHMENTS}/figure-0.png`);
    expect(first).toContain("written_by: owner");
  });
});

describe("slugOf", () => {
  it("makes a note id out of a filename", () => {
    expect(slugOf("Meeting Notes.md")).toBe("meeting-notes");
    expect(slugOf("2026-03-01 Acme call.md")).toBe("2026-03-01-acme-call");
  });

  it("always produces something usable", () => {
    expect(slugOf("!!!.md")).toBe("note");
    expect(slugOf("café.md")).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("the summary", () => {
  it("says what happened in sentences", () => {
    const lines = summaryLines({
      obsidian: true,
      notes: 50,
      attachments: 5,
      linksResolved: 61,
      linksUnresolved: [],
      skipped: [],
    });

    expect(lines.join(" ")).toContain("50 notes");
    expect(lines.join(" ")).toContain("Obsidian vault");
    expect(lines.join(" ")).toContain("61 links");
  });

  it("names the links that did not resolve rather than counting them", () => {
    // The owner is the only one who knows whether a broken link mattered, and
    // they cannot judge that from a number.
    const lines = summaryLines({
      obsidian: false,
      notes: 2,
      attachments: 0,
      linksResolved: 1,
      linksUnresolved: ["pricing", "old-plan"],
      skipped: [],
    });

    expect(lines.join(" ")).toContain("pricing");
    expect(lines.join(" ")).toContain("old-plan");
    expect(lines.join(" ")).toContain("left exactly as you wrote them");
  });

  it("warns about a skipped tools folder, and says to read it first", () => {
    const lines = summaryLines({
      obsidian: false,
      notes: 1,
      attachments: 0,
      linksResolved: 0,
      linksUnresolved: [],
      skipped: [{ path: "tools", reason: "tools are not imported unless asked" }],
    });

    expect(lines.join(" ")).toContain("--include-tools");
    expect(lines.join(" ")).toContain("run on this machine");
  });
});
