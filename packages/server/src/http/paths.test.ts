import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBrainPath } from "./paths.js";

function brain(): string {
  const root = mkdtempSync(join(tmpdir(), "staffroom-paths-"));
  const brainDir = join(root, "brain");
  mkdirSync(join(brainDir, "10-customers"), { recursive: true });
  writeFileSync(join(brainDir, "10-customers", "acme.md"), "# Acme\n", "utf8");
  writeFileSync(join(root, ".env"), "ANTHROPIC_API_KEY=sk-secret\n", "utf8");
  return brainDir;
}

describe("resolveBrainPath", () => {
  it("resolves a note inside the brain", () => {
    expect(resolveBrainPath(brain(), "10-customers/acme.md")).toContain("acme.md");
  });

  it("refuses to climb out with ..", () => {
    const dir = brain();
    for (const attempt of [
      "../.env",
      "10-customers/../../.env",
      "..%2F.env",
      "../../../../etc/passwd",
    ]) {
      expect(resolveBrainPath(dir, attempt), attempt).toBeUndefined();
    }
  });

  it("refuses an absolute path", () => {
    expect(resolveBrainPath(brain(), "/etc/passwd")).toBeUndefined();
    expect(resolveBrainPath(brain(), "\\windows\\system32\\config.md")).toBeUndefined();
  });

  it("refuses a null byte, which can truncate a path downstream", () => {
    expect(resolveBrainPath(brain(), "10-customers/acme.md\0.png")).toBeUndefined();
  });

  it("refuses an extension the viewer cannot show", () => {
    const dir = brain();
    writeFileSync(join(dir, "note.exe"), "x", "utf8");
    expect(resolveBrainPath(dir, "note.exe")).toBeUndefined();
  });

  it("refuses an empty path", () => {
    expect(resolveBrainPath(brain(), "")).toBeUndefined();
  });

  it("refuses a symlink pointing out of the brain", () => {
    const dir = brain();
    try {
      symlinkSync(join(dir, "..", ".env"), join(dir, "escape.md"));
    } catch {
      return; // Windows without developer mode cannot make one; nothing to prove here.
    }
    expect(resolveBrainPath(dir, "escape.md")).toBeUndefined();
  });

  it("refuses a file that is not there", () => {
    expect(resolveBrainPath(brain(), "10-customers/missing.md")).toBeUndefined();
  });

  it("accepts every extension the note viewer supports", () => {
    const dir = brain();
    for (const name of ["a.md", "b.txt", "c.png", "d.jpg", "e.pdf"]) {
      writeFileSync(join(dir, name), "x", "utf8");
      expect(resolveBrainPath(dir, name), name).toBeDefined();
    }
  });
});
