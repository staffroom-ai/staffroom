/**
 * Which markdown editor this machine has, if any.
 *
 * The rule worth protecting is the one that looks like a missing feature: when
 * nothing is detected, the office offers no button at all. On a Mac a `.md` with
 * no editor installed opens in TextEdit, which in rich-text mode rewrites the
 * file as RTF on save and destroys the front matter — so a button that fell back
 * to "whatever opens this" would quietly corrupt the owner's notes.
 *
 * The second rule is that nothing here runs anything. Detection looks for the
 * application; a process is only ever spawned when the owner clicks.
 */
import { describe, expect, it } from "vitest";
import { detectEditors, openCommandFor } from "./editors.js";

describe("detecting editors", () => {
  it("returns a list, whatever this machine has", () => {
    const found = detectEditors();
    expect(Array.isArray(found)).toBe(true);
  });

  it("gives every one an id and something to put on a button", () => {
    for (const editor of detectEditors()) {
      expect(editor.id).toMatch(/^[a-z]+$/);
      expect(editor.label.length).toBeGreaterThan(0);
    }
  });

  it("names only the three the office knows how to open a note in", () => {
    // Anything else would be a button whose behaviour nobody has checked.
    for (const editor of detectEditors()) {
      expect(["obsidian", "vscode", "typora"]).toContain(editor.id);
    }
  });

  it("does not repeat one", () => {
    const ids = detectEditors().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("opening a note in one", () => {
  it("is undefined for an editor this machine does not have", () => {
    expect(openCommandFor("emacs", "/tmp/a.md")).toBeUndefined();
    expect(openCommandFor("", "/tmp/a.md")).toBeUndefined();
  });

  it("refuses an id that is a command rather than an editor", () => {
    // This value arrives over the socket, and it ends in a spawn. Anything but a
    // known id has to fall through to nothing.
    for (const attempt of ["rm -rf /", "sh", "../../bin/sh", "obsidian; rm -rf /"]) {
      expect(openCommandFor(attempt, "/tmp/a.md")).toBeUndefined();
    }
  });

  it("passes the path as an argument, never as part of a command line", () => {
    for (const editor of detectEditors()) {
      const command = openCommandFor(editor.id, "/tmp/a note.md");
      expect(command).toBeDefined();
      // Separate argv entries: a path with a space in it is one argument, and
      // nothing here builds a string a shell would have to re-split.
      expect(command?.args).toContain("/tmp/a note.md");
    }
  });
});
