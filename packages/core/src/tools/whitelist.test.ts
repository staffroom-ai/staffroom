/**
 * Permissions the owner has already given.
 *
 * The match rule is the whole of this file's risk. "Approve and always allow" on
 * one email to a colleague must not become permission to email anyone, and the
 * way that goes wrong is a pattern that matches across a separator. Those cases
 * come first and in detail, because getting one wrong is a security hole rather
 * than a bug.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Tool } from "./tool.js";
import { approvalsPath, FileWhitelist, inputMatches, rowKey, valueMatches } from "./whitelist.js";

const made: string[] = [];
function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-allow-"));
  made.push(dir);
  writeFileSync(approvalsPath(dir), "allow: []\n", "utf8");
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const emailTool = { name: "send_email" } as Tool;

describe("a star never crosses a separator", () => {
  it("allows one address at the domain", () => {
    expect(valueMatches("*@acme.com", "a@acme.com")).toBe(true);
  });

  it("refuses a second address smuggled in behind a comma", () => {
    // This is the attack. The string still ends in @acme.com, so a naive glob
    // says yes, and permission to email a colleague has become permission to
    // email anyone at all.
    expect(valueMatches("*@acme.com", "evil@x.com,a@acme.com")).toBe(false);
  });

  it("refuses the other separators mail clients accept", () => {
    for (const value of [
      "evil@x.com;a@acme.com",
      "evil@x.com a@acme.com",
      "Name <evil@x.com> a@acme.com",
      "a@acme.com,b@acme.com",
      "a@acme.com\nb@acme.com",
      "a@acme.com\tb@acme.com",
    ]) {
      expect(valueMatches("*@acme.com", value), value).toBe(false);
    }
  });

  it("refuses a different domain", () => {
    expect(valueMatches("*@acme.com", "a@evil.com")).toBe(false);
  });

  it("does not let a brace expansion widen the pattern", () => {
    // nobrace: otherwise "{a,b}@acme.com" would quietly mean two things.
    expect(valueMatches("{a,b}@acme.com", "a@acme.com")).toBe(false);
  });

  it("does not let ** walk across a path", () => {
    expect(valueMatches("/safe/*", "/safe/a/b")).toBe(false);
    expect(valueMatches("/safe/*", "/safe/a")).toBe(true);
  });
});

describe("a list is allowed only if every part of it is", () => {
  it("allows a list where all the addresses match", () => {
    expect(valueMatches("*@acme.com", ["a@acme.com", "b@acme.com"])).toBe(true);
  });

  it("refuses a list with one address that does not", () => {
    // Nineteen good recipients and one bad one is still a bad send.
    expect(valueMatches("*@acme.com", ["a@acme.com", "evil@x.com"])).toBe(false);
  });

  it("refuses an empty list, which allows nothing and means nothing", () => {
    expect(valueMatches("*@acme.com", [])).toBe(false);
  });

  it("refuses a nested list containing something that does not match", () => {
    expect(valueMatches("*@acme.com", [["a@acme.com"], ["evil@x.com"]])).toBe(false);
  });
});

describe("values a pattern cannot sensibly allow", () => {
  it("compares numbers and booleans as written", () => {
    expect(valueMatches("42", 42)).toBe(true);
    expect(valueMatches("true", true)).toBe(true);
    expect(valueMatches("42", 43)).toBe(false);
  });

  it("never matches an object, a null or a missing field", () => {
    expect(valueMatches("*", { to: "a@acme.com" })).toBe(false);
    expect(valueMatches("*", null)).toBe(false);
    expect(valueMatches("*", undefined)).toBe(false);
  });
});

describe("matching a whole input", () => {
  it("requires every named field to match", () => {
    const match = { to: "*@acme.com", folder: "invoices/*" };
    expect(inputMatches(match, { to: "a@acme.com", folder: "invoices/2026" })).toBe(true);
    expect(inputMatches(match, { to: "a@acme.com", folder: "payroll/2026" })).toBe(false);
  });

  it("cannot match a value with a space in it, and that is the trade", () => {
    // The separator rule is applied to every field, not only recipient-looking
    // ones, because we cannot reliably tell which field of somebody else's tool
    // is a list of destinations. The cost is that a pattern only ever matches a
    // single token: "Invoice*" will not allow the subject "Invoice 12". That is
    // the right way round — a permission that is too narrow asks again, and a
    // permission that is too wide sends something it should not have.
    expect(valueMatches("Invoice*", "Invoice 12")).toBe(false);
    expect(valueMatches("Invoice*", "Invoice-12")).toBe(true);
  });

  it("ignores fields the row does not name", () => {
    expect(inputMatches({ to: "*@acme.com" }, { to: "a@acme.com", body: "anything" })).toBe(true);
  });

  it("treats an empty match as any input", () => {
    expect(inputMatches({}, { to: "anyone@anywhere" })).toBe(true);
    expect(inputMatches(undefined, { to: "anyone@anywhere" })).toBe(true);
  });

  it("refuses when the input is not an object at all", () => {
    expect(inputMatches({ to: "*" }, "a string")).toBe(false);
  });
});

describe("the file the owner owns", () => {
  it("allows a call once a permission is granted", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(false);

    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(true);
  });

  it("keeps a permission to one agent from covering another", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "dana")).toBe(false);
  });

  it("blocks the next call when the owner deletes the row and it reloads", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(true);

    // Taking a permission back has to be as easy as editing a file.
    writeFileSync(approvalsPath(dir), "allow: []\n", "utf8");
    list.reload();
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(false);
  });

  it("writes something the owner could have typed", () => {
    const dir = office();
    new FileWhitelist(dir).grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
    });
    const written = readFileSync(approvalsPath(dir), "utf8");
    expect(written).toContain("Delete a row to take the permission back");
    expect(written).toContain("send_email");
    expect(written).toContain("*@acme.com");
  });

  it("treats a half-edited file as no permissions rather than refusing to open", () => {
    const dir = office();
    writeFileSync(approvalsPath(dir), "allow: [ this is not valid", "utf8");
    const list = new FileWhitelist(dir);
    // Not "allow everything", and not a crash: ask about everything.
    expect(list.list()).toEqual([]);
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(false);
  });

  it("copes with no file at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-allow-none-"));
    made.push(dir);
    expect(new FileWhitelist(dir).list()).toEqual([]);
  });
});

describe("permissions do not last forever", () => {
  it("stops allowing a call once the row has expired", () => {
    const dir = office();
    const list = new FileWhitelist(dir, { whitelistDays: -1 });
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(false);
  });

  it("refreshes rather than stacking when the same thing is granted twice", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    expect(list.list()).toHaveLength(1);
  });

  it("revokes every row for a tool", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@other.com" } });
    expect(list.revoke("priya", "send_email")).toBe(2);
    expect(list.list()).toEqual([]);
  });
});

describe("allowing anything has to be asked for", () => {
  it("refuses a permission with nothing to match on", () => {
    const dir = office();
    // Somebody clicking "always allow" on one email does not mean "send anything
    // to anyone from now on".
    expect(() => new FileWhitelist(dir).grant({ agentId: "priya", tool: "send_email" })).toThrow(
      /explicitly/i,
    );
  });

  it("allows it when it is genuinely meant", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", allowAnyRecipient: true });
    expect(list.allows(emailTool, { to: "anyone@anywhere.com" }, "fp1", "priya")).toBe(true);
  });
});

describe("a tool that changed since it was allowed", () => {
  it("stops allowing the call when the fingerprint no longer matches", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });

    // The permission was for the tool as it was.
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp2", "priya")).toBe(false);
  });

  it("suspends the row and says so on the card", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });

    expect(list.suspendWhere("send_email", "fp2")).toBe(1);
    expect(list.changedSinceAllowed("priya", "send_email", { to: "a@acme.com" })).toBe(true);
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(false);
  });

  it("keeps the row rather than deleting it, because the owner decided it", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });
    list.suspendWhere("send_email", "fp2");
    expect(list.list()).toHaveLength(1);
    expect(list.list()[0]?.suspended).toBe(true);
  });

  it("leaves rows for other tools alone", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });
    expect(list.suspendWhere("post_message", "fp2")).toBe(0);
  });

  it("granting again clears the suspension and takes the new fingerprint", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });
    list.suspendWhere("send_email", "fp2");

    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp2",
    });
    expect(list.list()[0]?.suspended).toBeUndefined();
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp2", "priya")).toBe(true);
  });
});

describe("a row's identity", () => {
  it("is the same row twice, whatever order the match was written in", () => {
    // The key travels to a browser and comes back on a Revoke. Two readings of
    // the same permission have to agree, or the button misses.
    expect(rowKey({ agent: "priya", tool: "send_email", match: { to: "a", cc: "b" } })).toBe(
      rowKey({ agent: "priya", tool: "send_email", match: { cc: "b", to: "a" } }),
    );
  });

  it("tells two permissions for the same tool apart", () => {
    // This is what stops Revoke on one recipient taking back the others.
    expect(rowKey({ agent: "priya", tool: "send_email", match: { to: "a@acme.com" } })).not.toBe(
      rowKey({ agent: "priya", tool: "send_email", match: { to: "b@harlow.com" } }),
    );
  });

  it("tells two people apart, and a match from no match", () => {
    expect(rowKey({ agent: "priya", tool: "send_email", match: { to: "a" } })).not.toBe(
      rowKey({ agent: "sam", tool: "send_email", match: { to: "a" } }),
    );
    expect(rowKey({ agent: "priya", tool: "send_email" })).not.toBe(
      rowKey({ agent: "priya", tool: "send_email", match: { to: "a" } }),
    );
  });
});

describe("taking one permission back", () => {
  it("removes it from the file, and the next call asks again", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    const row = list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });
    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(true);

    expect(list.revokeKey(rowKey(row))).toBe(true);

    expect(list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya")).toBe(false);
    expect(readFileSync(approvalsPath(dir), "utf8")).not.toContain("send_email");
  });

  it("leaves the other permissions for that tool alone", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    const acme = list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@harlow.com" } });

    list.revokeKey(rowKey(acme));

    expect(list.list().map((r) => r.match?.["to"])).toEqual(["*@harlow.com"]);
  });

  it("says no for a key that matches nothing, without touching the file", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    const before = readFileSync(approvalsPath(dir), "utf8");

    expect(list.revokeKey("nobody\u0000nothing\u0000")).toBe(false);
    expect(readFileSync(approvalsPath(dir), "utf8")).toBe(before);
  });
});

describe("when a permission was last used", () => {
  it("is absent until the permission actually lets something through", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({ agentId: "priya", tool: "send_email", match: { to: "*@acme.com" } });
    expect(list.list()[0]?.last_used).toBeUndefined();
  });

  it("is written to the file, because the question is asked days later", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });

    list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya");

    // Read back off disk: a note kept only in memory would be gone by the time
    // anybody looks at the list, which is usually after a restart.
    expect(readFileSync(approvalsPath(dir), "utf8")).toContain("last_used");
    expect(new FileWhitelist(dir).list()[0]?.last_used).toBeDefined();
  });

  it("is not rewritten on every call in a loop", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });

    list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya");
    const first = list.list()[0]?.last_used;
    for (let i = 0; i < 20; i++) list.allows(emailTool, { to: "a@acme.com" }, "fp1", "priya");

    // An agent making twenty calls should not write the file twenty times; the
    // answer is read at day resolution anyway.
    expect(list.list()[0]?.last_used).toBe(first);
  });

  it("is not recorded for a call the permission refused", () => {
    const dir = office();
    const list = new FileWhitelist(dir);
    list.grant({
      agentId: "priya",
      tool: "send_email",
      match: { to: "*@acme.com" },
      fingerprint: "fp1",
    });

    // Wrong recipient, so the row did not let this through and did not "use" it.
    expect(list.allows(emailTool, { to: "someone@elsewhere.com" }, "fp1", "priya")).toBe(false);
    expect(list.list()[0]?.last_used).toBeUndefined();
  });
});
