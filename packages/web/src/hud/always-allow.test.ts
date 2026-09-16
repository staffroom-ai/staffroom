/**
 * What "always allow" proposes to permit.
 *
 * The owner is looking at one message to one person. The card's job is to turn
 * that into a permission narrow enough to be safe and wide enough to be useful,
 * and — the part that matters — to show it to them before anything is saved.
 *
 * Nothing here may widen a value on its own. Guessing `*@acme.com` from one
 * address at acme would be inventing a permission nobody asked for.
 */
import { describe, expect, it } from "vitest";
import {
  alwaysAllowSentence,
  canAlwaysAllow,
  matchFrom,
  proposeMatch,
  RECIPIENT_FIELDS,
} from "./always-allow.js";

describe("what the card proposes", () => {
  it("prefills a single recipient", () => {
    expect(proposeMatch({ to: "a@acme.com", body: "Hello" })).toEqual([
      { name: "to", value: "a@acme.com", actual: "a@acme.com", needsOwner: false },
    ]);
  });

  it("prefills a list of one, which is how MCP tools usually send", () => {
    // The acceptance case: to: ["list@northlight.example"] must arrive prefilled.
    const fields = proposeMatch({ to: ["list@northlight.example"] });
    expect(fields[0]?.value).toBe("list@northlight.example");
    expect(fields[0]?.needsOwner).toBe(false);
  });

  it("treats a list of the same address repeated as one address", () => {
    expect(proposeMatch({ to: ["a@acme.com", "a@acme.com"] })[0]?.value).toBe("a@acme.com");
  });

  it("refuses to invent a pattern for several different destinations", () => {
    // There is no honest single value here. Widening to *@acme.com would be a
    // permission the owner never asked for, so the field is left to them.
    const fields = proposeMatch({ to: ["a@acme.com", "b@other.com"] });
    expect(fields[0]?.value).toBe("");
    expect(fields[0]?.needsOwner).toBe(true);
    // They can still see what the call actually contained.
    expect(fields[0]?.actual).toBe("a@acme.com, b@other.com");
  });

  it("ignores fields that are not destinations", () => {
    expect(proposeMatch({ body: "Hello", subject: "Hi" })).toEqual([]);
  });

  it("covers every field name a card should recognise", () => {
    const input = Object.fromEntries(RECIPIENT_FIELDS.map((name) => [name, `${name}-value`]));
    expect(proposeMatch(input)).toHaveLength(RECIPIENT_FIELDS.length);
  });

  it("copes with an input that is not an object", () => {
    expect(proposeMatch("a string")).toEqual([]);
    expect(proposeMatch(null)).toEqual([]);
  });

  it("skips a field that is present but empty", () => {
    expect(proposeMatch({ to: "" })).toEqual([]);
    expect(proposeMatch({ to: [] })).toEqual([]);
  });
});

describe("what gets sent", () => {
  it("includes only fields the owner left something in", () => {
    expect(
      matchFrom([
        { name: "to", value: "a@acme.com", actual: "a@acme.com", needsOwner: false },
        { name: "cc", value: "", actual: "x, y", needsOwner: true },
      ]),
    ).toEqual({ to: "a@acme.com" });
  });

  it("trims what the owner typed", () => {
    expect(
      matchFrom([{ name: "to", value: "  a@acme.com  ", actual: "", needsOwner: false }]),
    ).toEqual({ to: "a@acme.com" });
  });
});

describe("whether it can be saved at all", () => {
  it("needs either a match or a deliberate tick", () => {
    const none = [{ name: "to", value: "", actual: "a, b", needsOwner: true }];
    // A tool with no destination to pin to cannot be always-allowed by accident.
    expect(canAlwaysAllow(none, false)).toBe(false);
    expect(canAlwaysAllow(none, true)).toBe(true);
  });

  it("is happy once a field has something in it", () => {
    expect(
      canAlwaysAllow([{ name: "to", value: "a@acme.com", actual: "", needsOwner: false }], false),
    ).toBe(true);
  });

  it("refuses an empty proposal without the tick", () => {
    expect(canAlwaysAllow([], false)).toBe(false);
  });
});

describe("the sentence the owner reads", () => {
  it("names the person, what it does, the real tool name and where", () => {
    // Every one of those is something they would want to have been told
    // afterwards, so it is all said before.
    expect(
      alwaysAllowSentence({
        agentName: "Priya",
        action: "Send an email.",
        toolName: "gmail.send_email",
        fields: [{ name: "to", value: "a@acme.com", actual: "", needsOwner: false }],
      }),
    ).toBe("Always allow Priya to send an email (gmail.send_email) to a@acme.com.");
  });

  it("still names a field that is not the obvious one", () => {
    expect(
      alwaysAllowSentence({
        agentName: "Priya",
        action: "Post a message",
        toolName: "slack.post",
        fields: [{ name: "channel", value: "#general", actual: "", needsOwner: false }],
      }),
    ).toBe("Always allow Priya to post a message (slack.post) to channel #general.");
  });

  it("says plainly when it is being allowed with any input", () => {
    expect(
      alwaysAllowSentence({
        agentName: "Sam",
        action: "Run a query",
        toolName: "sqlite_query",
        fields: [],
      }),
    ).toContain("with any input");
  });
});
