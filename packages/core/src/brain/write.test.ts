import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { markRejected, slugify, writeDeliverable } from "./write.js";

const brainDir = () => mkdtempSync(join(tmpdir(), "staffroom-write-"));
const base = {
  department: "marketing",
  agentId: "copywriter",
  runId: "run_1",
  now: new Date("2026-09-16T10:00:00Z"),
};

describe("slugify", () => {
  it("makes a filename-safe slug", () => {
    expect(slugify("Bakery tagline: fresh daily!")).toBe("bakery-tagline-fresh-daily");
  });

  it("never produces an empty slug", () => {
    expect(slugify("!!!")).toBe("untitled");
  });

  it("caps the length", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("writeDeliverable", () => {
  it("writes under the agent's own department, dated", () => {
    const dir = brainDir();
    const written = writeDeliverable(dir, {
      ...base,
      title: "Bakery tagline",
      body: "Fresh daily.",
    });
    expect(written.id).toBe("40-deliverables/marketing/2026-09-16-bakery-tagline");
  });

  it("fills the front matter the office reads back", () => {
    const dir = brainDir();
    const written = writeDeliverable(dir, {
      ...base,
      title: "Bakery tagline",
      body: "Fresh daily.",
      task: "routine:daily-post",
      model: "anthropic/claude-sonnet-5",
      toolsUsed: ["brain_search"],
      links: ["10-customers/acme"],
    });
    const parsed = matter(readFileSync(written.path, "utf8"));
    expect(parsed.data).toMatchObject({
      title: "Bakery tagline",
      written_by: "agent:copywriter",
      department: "marketing",
      run: "run_1",
      status: "draft",
      task: "routine:daily-post",
      model: "anthropic/claude-sonnet-5",
      tools_used: ["brain_search"],
      links: ["10-customers/acme"],
    });
    expect(parsed.content.trim()).toBe("Fresh daily.");
  });

  it("never overwrites: a second write the same day gets a suffix", () => {
    const dir = brainDir();
    const first = writeDeliverable(dir, { ...base, title: "Tagline", body: "one" });
    const second = writeDeliverable(dir, { ...base, title: "Tagline", body: "two" });
    const third = writeDeliverable(dir, { ...base, title: "Tagline", body: "three" });

    expect(first.id).toBe("40-deliverables/marketing/2026-09-16-tagline");
    expect(second.id).toBe("40-deliverables/marketing/2026-09-16-tagline-2");
    expect(third.id).toBe("40-deliverables/marketing/2026-09-16-tagline-3");
    expect(matter(readFileSync(first.path, "utf8")).content.trim()).toBe("one");
  });

  it("omits keys it was given nothing for, rather than writing empty ones", () => {
    const dir = brainDir();
    const written = writeDeliverable(dir, { ...base, title: "T", body: "b" });
    const data = matter(readFileSync(written.path, "utf8")).data;
    expect(data).not.toHaveProperty("task");
    expect(data).not.toHaveProperty("revises");
    expect(data).not.toHaveProperty("tools_used");
  });
});

describe("revision", () => {
  it("records what it revises and rejects the note it replaced", () => {
    const dir = brainDir();
    const original = writeDeliverable(dir, { ...base, title: "Tagline", body: "first attempt" });

    const revised = writeDeliverable(dir, {
      ...base,
      title: "Tagline",
      body: "second attempt",
      revises: original.id,
    });

    expect(matter(readFileSync(revised.path, "utf8")).data["revises"]).toBe(original.id);
    const before = matter(readFileSync(original.path, "utf8"));
    expect(before.data["status"]).toBe("rejected");
    // Nothing else about the older note changed.
    expect(before.content.trim()).toBe("first attempt");
    expect(before.data["title"]).toBe("Tagline");
  });

  it("leaves an approved note alone rather than rejecting it", () => {
    const dir = brainDir();
    const written = writeDeliverable(dir, { ...base, title: "T", body: "b" });
    const parsed = matter(readFileSync(written.path, "utf8"));
    parsed.data["status"] = "approved";
    writeFileSync(
      written.path,
      `---\n${stringify(parsed.data).trimEnd()}\n---\n\n${parsed.content.trim()}\n`,
      "utf8",
    );
    expect(markRejected(dir, written.id)).toBe(false);
  });

  it("says so when the note it revises is gone", () => {
    expect(markRejected(brainDir(), "40-deliverables/marketing/nothing")).toBe(false);
  });
});
