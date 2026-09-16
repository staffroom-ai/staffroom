/**
 * The strip's job is to make a broken connector impossible to miss, and to say
 * what is wrong in words. Both are tested here, because both are the kind of
 * thing that decays quietly when somebody adds a health state later.
 */
import type { Connector } from "@staffroom/core";
import { describe, expect, it } from "vitest";
import {
  HEALTH_WORD,
  initials,
  needsAttention,
  order,
  toolCountWord,
  whereWord,
} from "./Connectors.js";

function connector(overrides: Partial<Connector> & { id: string }): Connector {
  return {
    kind: "mcp",
    label: overrides.id,
    health: "ok",
    message: null,
    toolCount: 3,
    departments: "all",
    lastUsedAt: null,
    pulse: 0,
    ...overrides,
  };
}

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Notion Workspace")).toBe("NW");
  });

  it("takes two letters when there is only one word", () => {
    expect(initials("stripe")).toBe("ST");
  });

  it("splits on the punctuation a server name actually uses", () => {
    expect(initials("google-drive")).toBe("GD");
    expect(initials("acme_crm")).toBe("AC");
  });

  it("does not throw on a label with nothing in it", () => {
    expect(initials("···")).toBe("?");
  });
});

describe("order", () => {
  it("puts anything the owner can fix first, whatever its kind", () => {
    const sorted = order([
      connector({ id: "a", kind: "mcp", health: "ok" }),
      connector({ id: "b", kind: "builtin", health: "down" }),
      connector({ id: "c", kind: "mcp", health: "ok" }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("orders healthy connectors by kind, then by most recently used", () => {
    const sorted = order([
      connector({ id: "builtin", kind: "builtin" }),
      connector({ id: "old", kind: "mcp", lastUsedAt: "2026-09-01T10:00:00.000Z" }),
      connector({ id: "recent", kind: "mcp", lastUsedAt: "2026-09-15T10:00:00.000Z" }),
      connector({ id: "own", kind: "custom" }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["recent", "old", "own", "builtin"]);
  });

  it("is stable on labels so the strip does not reshuffle between renders", () => {
    const sorted = order([connector({ id: "b", label: "B" }), connector({ id: "a", label: "A" })]);
    expect(sorted.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not mutate what it was given", () => {
    const given = [connector({ id: "ok" }), connector({ id: "bad", health: "down" })];
    order(given);
    expect(given.map((c) => c.id)).toEqual(["ok", "bad"]);
  });
});

describe("needsAttention", () => {
  it("is true only for the states with something the owner can do", () => {
    expect(needsAttention("auth_required")).toBe(true);
    expect(needsAttention("down")).toBe(true);
    expect(needsAttention("load_failed")).toBe(true);
    expect(needsAttention("ok")).toBe(false);
    expect(needsAttention("starting")).toBe(false);
    // Denied is the owner's own decision. Nothing is broken and nothing is asked.
    expect(needsAttention("denied")).toBe(false);
    expect(needsAttention("grey")).toBe(false);
  });
});

describe("HEALTH_WORD", () => {
  it("has a plain sentence for every state, so colour is never the only signal", () => {
    const states: Connector["health"][] = [
      "ok",
      "starting",
      "auth_required",
      "down",
      "load_failed",
      "denied",
      "grey",
    ];
    for (const state of states) {
      expect(HEALTH_WORD[state]).toMatch(/^[a-z]/);
    }
    expect(new Set(Object.values(HEALTH_WORD)).size).toBe(states.length);
  });
});

describe("card wording", () => {
  it("does not say 1 tools", () => {
    expect(toolCountWord(1)).toBe("1 tool");
    expect(toolCountWord(0)).toBe("0 tools");
    expect(toolCountWord(9)).toBe("9 tools");
  });

  it("says who a connector is for", () => {
    expect(whereWord("all")).toBe("every department");
    expect(whereWord(["studio", "back-office"])).toBe("studio, back-office");
    // A server nobody can use yet should say so rather than read as unrestricted.
    expect(whereWord([])).toBe("nobody yet");
  });
});
