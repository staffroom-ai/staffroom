/**
 * Two small facts the tool cards are built on.
 *
 * The first is that a tool remembers whether its author wrote a scope. `write`
 * is the safe default, but "asks every time because it sends email" and "asks
 * every time because somebody forgot a line" are different situations and only
 * one of them is worth telling the owner about — and once the default has been
 * applied they look identical.
 *
 * The second is that a file which would not compile can say where. An owner
 * staring at "could not be loaded" with no line has to go hunting.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { failureLine } from "./loader.js";
import { tool } from "./tool.js";

const base = {
  name: "lookup_order",
  description: "Looks an order up.",
  input: z.object({ id: z.string() }),
  run: async () => ({}),
};

describe("scopeAssumed", () => {
  it("is set when the author left the scope out", () => {
    const made = tool({ ...base });
    expect(made.scope).toBe("write");
    expect(made.scopeAssumed).toBe(true);
  });

  it("is not set when they wrote one, even the same one", () => {
    expect(tool({ ...base, scope: "write" }).scopeAssumed).toBe(false);
    expect(tool({ ...base, scope: "read" }).scopeAssumed).toBe(false);
  });

  it("cannot be cleared by the author", () => {
    // The stamp is the office's, not the tool file's: a tool that could clear it
    // would be a tool that silences the warning about itself.
    const made = tool({ ...base, scopeAssumed: false } as never);
    expect(made.scopeAssumed).toBe(true);
  });
});

describe("failureLine", () => {
  it("reads the line off the compiler's own error", () => {
    expect(failureLine({ errors: [{ location: { line: 12 } }] })).toBe(12);
  });

  it("skips an error that did not say where", () => {
    expect(failureLine({ errors: [{ text: "oops" }, { location: { line: 4 } }] })).toBe(4);
  });

  it("is undefined for anything else", () => {
    expect(failureLine(new Error("plain"))).toBeUndefined();
    expect(failureLine({ errors: [] })).toBeUndefined();
    expect(failureLine(undefined)).toBeUndefined();
    expect(failureLine("a string")).toBeUndefined();
    // A line number of zero is not a line.
    expect(failureLine({ errors: [{ location: { line: 0 } }] })).toBeUndefined();
  });
});
