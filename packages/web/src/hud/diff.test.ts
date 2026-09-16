/**
 * Comparing one draft with the one before it.
 *
 * The thing worth protecting is that a diff never loses a line. Somebody reading
 * two versions of their own writing is deciding whether the change was an
 * improvement, and a comparison that quietly dropped a paragraph would be worse
 * than showing them nothing at all.
 */
import { describe, expect, it } from "vitest";
import { diffLines, isUnchanged, revisionLabel } from "./diff.js";

const text = (lines: string[]): string => lines.join("\n");

describe("diffLines", () => {
  it("says nothing changed when nothing did", () => {
    const lines = diffLines("one\ntwo", "one\ntwo");
    expect(isUnchanged(lines)).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("marks an inserted line without disturbing the ones around it", () => {
    const lines = diffLines(text(["a", "c"]), text(["a", "b", "c"]));

    expect(lines).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("marks a deleted line", () => {
    const lines = diffLines(text(["a", "b", "c"]), text(["a", "c"]));
    expect(lines.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["b"]);
  });

  it("shows a rewrite as the old line out and the new line in", () => {
    const lines = diffLines("Hi Marta,", "Hello Marta,");

    expect(lines.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["Hi Marta,"]);
    expect(lines.filter((l) => l.kind === "added").map((l) => l.text)).toEqual(["Hello Marta,"]);
  });

  it("never loses a line, whatever the change", () => {
    const before = text(["a", "b", "c", "d", "e"]);
    const after = text(["a", "x", "c", "y", "e", "f"]);
    const lines = diffLines(before, after);

    // Everything in either version has to appear somewhere in the comparison.
    const kept = new Set(lines.map((l) => l.text));
    for (const line of [...before.split("\n"), ...after.split("\n")]) {
      expect(kept.has(line)).toBe(true);
    }
  });

  it("reads back as the new version when the additions are kept", () => {
    const after = text(["one", "two", "three"]);
    const lines = diffLines(text(["one", "zero", "three"]), after);

    const rebuilt = lines
      .filter((l) => l.kind !== "removed")
      .map((l) => l.text)
      .join("\n");
    expect(rebuilt).toBe(after);
  });

  it("handles one side being empty", () => {
    expect(diffLines("", "new").every((l) => l.kind !== "same" || l.text === "")).toBe(true);
    expect(diffLines("old", "").some((l) => l.kind === "removed")).toBe(true);
  });

  it("falls back to a whole-file comparison rather than grinding on a huge one", () => {
    const huge = Array.from({ length: 2_500 }, (_, i) => `line ${i}`).join("\n");
    const lines = diffLines(huge, `${huge}\nextra`);

    // Honest rather than slow: every old line out, every new line in.
    expect(lines.some((l) => l.kind === "same")).toBe(false);
    expect(lines.some((l) => l.text === "extra" && l.kind === "added")).toBe(true);
  });
});

describe("which draft am I looking at", () => {
  const chain = ["d/v1", "d/v2", "d/v3"];

  it("names the position and what it replaced", () => {
    expect(revisionLabel(chain, "d/v3")).toBe("v3, revised from v2");
    expect(revisionLabel(chain, "d/v2")).toBe("v2, revised from v1");
  });

  it("says the first draft is the first, rather than claiming it revised something", () => {
    expect(revisionLabel(chain, "d/v1")).toBe("v1 of 3");
  });

  it("says nothing at all when there is no chain to speak of", () => {
    expect(revisionLabel(["only"], "only")).toBeUndefined();
    expect(revisionLabel(chain, "not/in/it")).toBeUndefined();
  });
});
