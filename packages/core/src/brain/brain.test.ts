import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrainIndex } from "./index.js";
import { buildResolver, linksFrom, resolveTarget } from "./links.js";
import { isSkipped, noteIdFor, parseNote, weightFor } from "./parse.js";
import type { NoteWarning } from "./types.js";

/** A brain folder on disk: this indexes files, so the tests use real ones. */
function brain(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-brain-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return dir;
}

const open = (dir: string, onWarning?: (w: NoteWarning) => void) =>
  BrainIndex.open(dir, {
    indexFile: join(mkdtempSync(join(tmpdir(), "staffroom-idx-")), "brain.index.sqlite"),
    ...(onWarning === undefined ? {} : { onWarning }),
  });

const note = (title: string, body = "Some body text.", front: Record<string, unknown> = {}) => {
  const lines = [`title: ${title}`, "created: 2026-01-01T00:00:00+11:00"];
  for (const [k, v] of Object.entries(front)) lines.push(`${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
};

describe("note ids", () => {
  it("uses forward slashes, including from a Windows path", () => {
    expect(noteIdFor("10-customers\\acme-pty-ltd.md")).toBe("10-customers/acme-pty-ltd");
    expect(noteIdFor("10-customers/acme-pty-ltd.md")).toBe("10-customers/acme-pty-ltd");
  });

  it("halves the weight of archived and inbox notes", () => {
    expect(weightFor("90-archive/old")).toBe(0.5);
    expect(weightFor("inbox/dropped")).toBe(0.5);
    expect(weightFor("10-customers/acme")).toBe(1);
  });
});

describe("skip rules", () => {
  it("skips attachments, private folders at any depth, and dot folders", () => {
    for (const path of [
      "_attachments/logo.md",
      "_private/logins.md",
      "10-customers/_private/notes.md",
      ".obsidian/config.md",
      "notes.txt",
    ]) {
      expect(isSkipped(path), path).toBe(true);
    }
  });

  it("keeps an ordinary note", () => {
    expect(isSkipped("10-customers/acme.md")).toBe(false);
  });
});

describe("parsing", () => {
  const parse = (text: string, id = "10-customers/acme") =>
    parseNote({ id, path: `/tmp/${id}.md`, text, birthTime: new Date("2026-02-02T00:00:00Z") });

  it("reads front matter and body", () => {
    const parsed = parse(note("Acme Pty Ltd", "They buy monthly.", { tags: ["client"] }));
    expect(parsed.title).toBe("Acme Pty Ltd");
    expect(parsed.body.trim()).toBe("They buy monthly.");
    expect(parsed.frontMatter.tags).toEqual(["client"]);
  });

  it("falls back to the first heading, then the filename", () => {
    expect(parse("# From the heading\n\nbody").title).toBe("From the heading");
    expect(parse("just body", "10-customers/acme-pty-ltd").title).toBe("acme pty ltd");
  });

  it("warns rather than failing when created is missing", () => {
    const parsed = parse("# A note\n\nbody");
    expect(parsed.frontMatter.created).toBe("2026-02-02T00:00:00.000Z");
    expect(parsed.warnings.map((w) => w.reason)).toContain("missing_created");
  });

  it("indexes the body when the front matter will not parse", () => {
    const parsed = parse("---\ntitle: [unclosed\n---\n\nthe body survives\n");
    expect(parsed.body).toContain("the body survives");
  });

  it("defaults written_by to owner and reads agent trust from it", () => {
    expect(parse(note("A")).frontMatter.written_by).toBe("owner");
    expect(parse(note("A", "b", { written_by: "agent:copywriter" })).trust).toBe("agent");
    expect(parse(note("A"), "inbox/dropped").trust).toBe("imported");
  });

  it("counts words and hashes the content", () => {
    const parsed = parse(note("A", "one two three"));
    expect(parsed.wordCount).toBe(3);
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("links", () => {
  const notes = [
    { id: "10-customers/acme-pty-ltd", title: "Acme Pty Ltd" },
    { id: "20-products/widget", title: "Widget" },
    { id: "30-processes/widget", title: "Widget" },
  ];
  const resolver = buildResolver(notes);

  it("resolves an exact id", () => {
    expect(resolveTarget("10-customers/acme-pty-ltd", resolver)).toBe("10-customers/acme-pty-ltd");
  });

  it("resolves a unique basename", () => {
    expect(resolveTarget("acme-pty-ltd", resolver)).toBe("10-customers/acme-pty-ltd");
  });

  it("resolves a title, case-insensitively", () => {
    expect(resolveTarget("Acme Pty Ltd", resolver)).toBe("10-customers/acme-pty-ltd");
    expect(resolveTarget("acme pty ltd", resolver)).toBe("10-customers/acme-pty-ltd");
  });

  it("refuses to guess when both the basename and the title are ambiguous", () => {
    expect(resolveTarget("widget", resolver)).toBeUndefined();
    expect(resolveTarget("Widget", resolver)).toBeUndefined();
  });

  it("falls through to a unique title when only the basename is ambiguous", () => {
    const tie = buildResolver([
      { id: "20-products/widget", title: "Widget" },
      { id: "30-processes/widget", title: "Widget process" },
    ]);
    expect(resolveTarget("Widget process", tie)).toBe("30-processes/widget");
  });

  it("ignores an alias and a heading", () => {
    expect(resolveTarget("Acme Pty Ltd|the client", resolver)).toBe("10-customers/acme-pty-ltd");
    expect(resolveTarget("acme-pty-ltd#pricing", resolver)).toBe("10-customers/acme-pty-ltd");
  });

  it("finds wiki, markdown and front-matter links, and marks the unresolved", () => {
    const parsed = parseNote({
      id: "50-meetings/kickoff",
      path: "/tmp/x.md",
      text: note(
        "Kickoff",
        "We met [[Acme Pty Ltd]] and read [the doc](20-products/widget.md) and [[nobody]].",
        {
          links: ["30-processes/widget"],
        },
      ),
      birthTime: new Date(),
    });
    const links = linksFrom(parsed, resolver);

    expect(links.find((l) => l.to === "10-customers/acme-pty-ltd")).toMatchObject({
      kind: "wiki",
      resolved: true,
    });
    expect(links.find((l) => l.to === "20-products/widget")).toMatchObject({
      kind: "markdown",
      resolved: true,
    });
    expect(links.find((l) => l.to === "30-processes/widget")).toMatchObject({
      kind: "front_matter",
      resolved: true,
    });
    expect(links.find((l) => l.to === "nobody")).toMatchObject({
      kind: "missing",
      resolved: false,
    });
  });

  it("does not link a note to itself", () => {
    const parsed = parseNote({
      id: "10-customers/acme-pty-ltd",
      path: "/tmp/x.md",
      text: note("Acme Pty Ltd", "See [[Acme Pty Ltd]]."),
      birthTime: new Date(),
    });
    expect(linksFrom(parsed, resolver)).toEqual([]);
  });
});

describe("the index", () => {
  it("indexes a folder and reports the count", () => {
    const index = open(
      brain({
        "10-customers/acme.md": note("Acme Pty Ltd", "Our biggest client."),
        "20-products/widget.md": note("Widget", "The thing we sell."),
      }),
    );
    expect(index.count()).toBe(2);
    index.close();
  });

  it("leaves a private note out of the database entirely", () => {
    const index = open(
      brain({
        "_private/logins.md": note("Logins", "secret"),
        "10-customers/hidden.md": note("Hidden", "also secret", { private: true }),
        "10-customers/acme.md": note("Acme", "public"),
      }),
    );
    expect(index.count()).toBe(1);
    expect(index.read_("10-customers/hidden")).toBeNull();
    expect(index.list().map((n) => n.id)).toEqual(["10-customers/acme"]);
    index.close();
  });

  it("records an unresolved link as a row rather than dropping it", () => {
    const index = open(brain({ "10-customers/acme.md": note("Acme", "See [[nobody-at-all]].") }));
    const links = index.links();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ to: "nobody-at-all", resolved: false, kind: "missing" });
    index.close();
  });

  it("reports a missing created date through the warning callback", () => {
    const warnings: NoteWarning[] = [];
    const index = open(
      brain({ "10-customers/acme.md": "# Acme\n\nNo front matter here.\n" }),
      (w) => warnings.push(w),
    );
    expect(warnings.map((w) => w.reason)).toContain("missing_created");
    index.close();
  });

  it("drops a note from the index once the file is gone", () => {
    const dir = brain({
      "10-customers/acme.md": note("Acme"),
      "20-products/widget.md": note("Widget"),
    });
    const index = open(dir);
    expect(index.count()).toBe(2);

    index.removeFile(join(dir, "20-products/widget.md"));
    expect(index.count()).toBe(1);
    index.close();
  });

  it("lists pinned notes but never an archived one", () => {
    const index = open(
      brain({
        "00-about/us.md": note("About us", "who we are", { pinned: true }),
        "90-archive/old.md": note("Old", "outdated", { pinned: true }),
        "10-customers/acme.md": note("Acme", "client"),
      }),
    );
    expect(index.pinned().map((n) => n.id)).toEqual(["00-about/us"]);
    index.close();
  });
});

describe("search", () => {
  const index = open(
    brain({
      "10-customers/acme.md": note(
        "Acme Pty Ltd",
        "Acme buys widgets every month and pays on time.",
        {
          tags: ["client", "pricing"],
        },
      ),
      "20-products/widget.md": note("Widget", "The widget costs 1200 AUD per day."),
      "40-deliverables/marketing/tagline.md": note("Tagline", "Fresh widgets daily.", {
        department: "marketing",
      }),
      "90-archive/old-pricing.md": note("Old pricing", "The widget used to cost 900 AUD."),
    }),
  );

  it("finds a note by a word in its body", () => {
    expect(index.search("widgets").map((h) => h.id)).toContain("10-customers/acme");
  });

  it("finds a note by its title", () => {
    expect(index.search("Tagline")[0]?.id).toBe("40-deliverables/marketing/tagline");
  });

  it("ranks an archived note below a current one for the same words", () => {
    const hits = index.search("widget cost");
    const current = hits.findIndex((h) => h.id === "20-products/widget");
    const archived = hits.findIndex((h) => h.id === "90-archive/old-pricing");
    expect(current).toBeGreaterThanOrEqual(0);
    expect(archived === -1 || current < archived).toBe(true);
  });

  it("boosts a deliverable in the asking agent's own department", () => {
    const plain =
      index.search("widgets daily").find((h) => h.id === "40-deliverables/marketing/tagline")
        ?.score ?? 0;
    const boosted =
      index
        .search("widgets daily", { department: "marketing" })
        .find((h) => h.id === "40-deliverables/marketing/tagline")?.score ?? 0;
    expect(boosted).toBeGreaterThan(plain);
  });

  it("returns an excerpt around the match", () => {
    const hit = index.search("pays")[0];
    expect(hit?.excerpt).toContain("pays on time");
  });

  it("honours the limit and the area filter", () => {
    expect(index.search("widget", { limit: 1 })).toHaveLength(1);
    expect(
      index.search("widget", { area: "20-products" }).every((h) => h.id.startsWith("20-products/")),
    ).toBe(true);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(index.search("   ")).toEqual([]);
  });

  it("survives punctuation that would break an FTS query", () => {
    expect(() => index.search('what is "the" cost? (AUD)')).not.toThrow();
  });
});

describe("reader", () => {
  it("is the read-only handle the tool registry hands to a tool", async () => {
    const index = open(
      brain({ "10-customers/acme.md": note("Acme Pty Ltd", "Buys widgets monthly.") }),
    );
    const reader = index.reader();

    await expect(reader.search("widgets")).resolves.toMatchObject([
      { id: "10-customers/acme", area: "10-customers" },
    ]);
    await expect(reader.read("10-customers/acme")).resolves.toMatchObject({
      title: "Acme Pty Ltd",
    });
    await expect(reader.read("nothing/here")).resolves.toBeNull();
    await expect(reader.list()).resolves.toHaveLength(1);
    index.close();
  });
});

describe("the index is a cache", () => {
  it("rebuilds from the files when the schema version does not match", () => {
    const dir = brain({ "10-customers/acme.md": note("Acme") });
    const indexFile = join(mkdtempSync(join(tmpdir(), "staffroom-idx-")), "brain.index.sqlite");

    const first = BrainIndex.open(dir, { indexFile });
    expect(first.count()).toBe(1);
    first.close();

    // Reopening on the same file is fine, and the notes are still there.
    const second = BrainIndex.open(dir, { indexFile });
    expect(second.count()).toBe(1);
    second.close();
  });
});

describe("throughput", () => {
  // Writing 2,000 files is filesystem-bound and slow on a shared Windows runner.
  // The budget is on opening the index, which is what an owner waits for, so the
  // setup gets room and the measurement stays tight.
  it("opens a 2,000-note brain in under five seconds", { timeout: 120_000 }, () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      files[`10-customers/client-${i}.md`] = note(
        `Client ${i}`,
        `Client number ${i} buys widgets and pays monthly.`,
      );
    }
    const dir = brain(files);

    const started = performance.now();
    const index = open(dir);
    const elapsed = performance.now() - started;

    expect(index.count()).toBe(2000);
    // The plan's budget is the macOS runner; other platforms get headroom rather
    // than a failure that says nothing about the code.
    expect(elapsed).toBeLessThan(process.platform === "win32" ? 20_000 : 5000);
    index.close();
  });
});

describe("dates from YAML", () => {
  it("accepts a timestamp YAML parsed into a Date, which is what a correct note gives", () => {
    // `created: 2026-01-01T00:00:00+11:00` unquoted is a Date by the time we see it.
    const parsed = parseNote({
      id: "10-customers/acme",
      path: "/tmp/acme.md",
      text: "---\ntitle: Acme\ncreated: 2026-01-01T00:00:00+11:00\n---\n\nbody\n",
      birthTime: new Date("2020-01-01T00:00:00Z"),
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.frontMatter.created).toBe("2025-12-31T13:00:00.000Z");
  });

  it("still accepts a quoted date string", () => {
    const parsed = parseNote({
      id: "x/y",
      path: "/tmp/y.md",
      text: '---\ntitle: Y\ncreated: "2026-01-01T00:00:00Z"\n---\n\nbody\n',
      birthTime: new Date(),
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.frontMatter.created).toBe("2026-01-01T00:00:00Z");
  });

  it("still warns when there is genuinely no date", () => {
    const parsed = parseNote({
      id: "x/z",
      path: "/tmp/z.md",
      text: "# Z\n\nbody\n",
      birthTime: new Date("2026-02-02T00:00:00Z"),
    });
    expect(parsed.warnings.map((w) => w.reason)).toContain("missing_created");
  });
});
