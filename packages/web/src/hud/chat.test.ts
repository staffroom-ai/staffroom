/**
 * The chat tab's logic, tested without a DOM.
 *
 * The rendering is thin; what can actually be wrong is how a note file is split
 * into front matter and body, and whether the reveal button names the right file
 * manager on the owner's own machine.
 */
import { describe, expect, it } from "vitest";
import { revealLabel } from "./Chat.js";
import { parseNote } from "./NoteSheet.js";

describe("revealLabel", () => {
  it("names the file manager each platform actually has", () => {
    expect(revealLabel("mac")).toBe("Show in Finder");
    expect(revealLabel("windows")).toBe("Show in Explorer");
    expect(revealLabel("linux")).toBe("Show in file manager");
  });
});

describe("parseNote", () => {
  it("splits front matter from the body", () => {
    const note = parseNote(
      [
        "---",
        "title: Bakery tagline",
        "agent: priya",
        "---",
        "",
        "# Bakery tagline",
        "",
        "Two lines.",
      ].join("\n"),
    );
    expect(note.frontMatter).toEqual([
      ["title", "Bakery tagline"],
      ["agent", "priya"],
    ]);
    expect(note.body.trim().startsWith("# Bakery tagline")).toBe(true);
  });

  it("treats a note with no front matter as all body", () => {
    const note = parseNote("# Just a heading\n\nAnd a line.");
    expect(note.frontMatter).toEqual([]);
    expect(note.body).toBe("# Just a heading\n\nAnd a line.");
  });

  it("strips the quotes a YAML writer adds", () => {
    expect(parseNote(["---", 'title: "Quoted"', "---", "body"].join("\n")).frontMatter).toEqual([
      ["title", "Quoted"],
    ]);
  });

  it("drops empty keys rather than showing blank rows", () => {
    const note = parseNote(["---", "title: Kept", "approved:", "---", "body"].join("\n"));
    expect(note.frontMatter).toEqual([["title", "Kept"]]);
  });

  it("handles CRLF, because a note may have been edited on Windows", () => {
    const note = parseNote("---\r\ntitle: Windows\r\n---\r\nbody\r\n");
    expect(note.frontMatter).toEqual([["title", "Windows"]]);
    expect(note.body.trim()).toBe("body");
  });

  it("does not mistake a horizontal rule mid-note for front matter", () => {
    const note = parseNote("# Heading\n\n---\n\nAfter the rule.");
    expect(note.frontMatter).toEqual([]);
    expect(note.body).toContain("After the rule.");
  });
});
