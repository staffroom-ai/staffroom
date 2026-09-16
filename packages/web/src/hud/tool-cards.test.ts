/**
 * The exact sentences the tool cards say.
 *
 * `tools-mcp-approvals.md` fixes this wording, and it is the wording an owner
 * pastes into an issue when a tool of theirs will not load, so it is worth
 * holding to rather than leaving to whoever next edits the markup.
 */
import { describe, expect, it } from "vitest";
import type { ToolNotice } from "../store.js";
import {
  asksWhoMayUse,
  assignText,
  failureDetail,
  failureText,
  noScopeText,
  toolOf,
} from "./tool-cards.js";

function notice(overrides: Partial<ToolNotice> = {}): ToolNotice {
  return { id: 1, file: "lookup-order.ts", ok: true, ...overrides };
}

describe("a file that would not load", () => {
  it("says the line when the compiler said one", () => {
    expect(failureDetail({ line: 12, message: "Unexpected end of file" })).toBe(
      "Line 12: Unexpected end of file",
    );
  });

  it("says just the message when it did not", () => {
    expect(failureDetail({ message: "the file has no default export." })).toBe(
      "the file has no default export.",
    );
  });

  it("still says something when there is no message at all", () => {
    expect(failureDetail({})).toBe("It could not be loaded.");
  });

  it("names the file, so the owner knows which one to open", () => {
    const text = failureText(notice({ ok: false, line: 12, message: "Unexpected end of file" }));
    expect(text).toBe(
      "Your tool file lookup-order.ts could not be loaded. Line 12: Unexpected end of file",
    );
  });
});

describe("the no-scope warning", () => {
  it("is the sentence from the spec, word for word", () => {
    expect(noScopeText("lookup-order.ts")).toBe(
      'office/tools/lookup-order.ts has no scope, so it will ask for approval every time. Add scope: "read" if it only looks things up.',
    );
  });

  it("says what happens, not only what is missing", () => {
    // "has no scope" on its own tells nobody why they should care.
    expect(noScopeText("x.ts")).toContain("ask for approval every time");
  });
});

describe("who may use it", () => {
  it("asks by name", () => {
    expect(assignText("lookup_order")).toBe("New tool lookup_order is ready. Who may use it?");
  });

  it("asks when the tool is new and nobody has it", () => {
    expect(asksWhoMayUse(notice({ name: "lookup_order", unassigned: true }))).toBe(true);
  });

  it("does not ask again about a tool somebody already has", () => {
    // Re-saving a file is ordinary. Asking every time is how a card stops being read.
    expect(asksWhoMayUse(notice({ name: "lookup_order" }))).toBe(false);
  });

  it("does not ask about a file that failed to load", () => {
    expect(asksWhoMayUse(notice({ ok: false, name: "lookup_order", unassigned: true }))).toBe(
      false,
    );
  });

  it("does not ask when there is no tool to give out", () => {
    expect(asksWhoMayUse(notice({ unassigned: true }))).toBe(false);
  });
});

describe("toolOf", () => {
  it("prefers the name the office named", () => {
    expect(toolOf(notice({ name: "lookup_order", tools: ["other"] }))).toBe("lookup_order");
  });

  it("falls back to the first of the file's tools", () => {
    expect(toolOf(notice({ tools: ["lookup_order"] }))).toBe("lookup_order");
  });

  it("is undefined when the file defined none", () => {
    expect(toolOf(notice())).toBeUndefined();
  });
});
