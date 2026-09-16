/**
 * The one route that writes a file the owner did not type.
 *
 * Most of what is protected here is the filename. A multipart filename is text
 * an attacker chooses that is about to become a path, and the list of ways that
 * goes wrong — traversal, absolute paths, Windows drives and device names,
 * dotfiles, NUL bytes, a second extension — is longer than anybody's list of
 * checks. So the name is not checked, it is thrown away and rebuilt from a
 * character class that cannot be any of those things.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freeName, INBOX, MAX_UPLOAD_BYTES, safeName, storeUpload } from "./upload.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function brain(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-upload-"));
  dirs.push(dir);
  return dir;
}

describe("the filename", () => {
  it("keeps an ordinary one, lowercased", () => {
    expect(safeName("Meeting Notes.md", "note")).toBe("meeting-notes.md");
  });

  it("cannot become a path, however it is written", () => {
    for (const attempt of [
      "../../../etc/passwd.md",
      "..\\..\\windows\\system32\\config.md",
      "/etc/shadow.md",
      "C:\\Users\\me\\.ssh\\id_rsa.md",
      "a/b/c.md",
    ]) {
      const name = safeName(attempt, "note");
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).not.toContain("..");
      expect(name).not.toContain(":");
    }
  });

  it("cannot become a dotfile", () => {
    expect(safeName(".bashrc.md", "note").startsWith(".")).toBe(false);
    expect(safeName("...md", "note")).toBe("note.md");
  });

  it("cannot carry a NUL byte through", () => {
    expect(safeName("evil\u0000.md", "note")).not.toContain("\u0000");
  });

  it("takes only the last extension, not a claimed one", () => {
    // `report.md.exe` is an executable, whatever the middle of its name says.
    expect(safeName("report.md.exe", "note")).toBe("");
    expect(safeName("report.exe.md", "note")).toBe("report-exe.md");
  });

  it("refuses anything that is not markdown, text or pdf", () => {
    for (const bad of ["a.exe", "a.sh", "a.js", "a.yaml", "a"]) {
      expect(safeName(bad, "note")).toBe("");
    }
    for (const good of ["a.md", "a.txt", "a.pdf", "a.PDF"]) {
      expect(safeName(good, "note")).not.toBe("");
    }
  });

  it("does not run away with a very long name", () => {
    expect(safeName(`${"x".repeat(500)}.md`, "note").length).toBeLessThanOrEqual(84);
  });
});

describe("not landing on somebody's writing", () => {
  it("makes room rather than overwriting", () => {
    const dir = brain();
    writeFileSync(join(dir, "notes.md"), "the first one", "utf8");

    expect(freeName(dir, "notes.md")).toBe("notes-2.md");
  });

  it("keeps both files when the same name is uploaded twice", () => {
    const dir = brain();
    const first = storeUpload(dir, { filename: "notes.md", content: Buffer.from("first") });
    const second = storeUpload(dir, { filename: "notes.md", content: Buffer.from("second") });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(readFileSync(first.path, "utf8")).toBe("first");
    expect(readFileSync(second.path, "utf8")).toBe("second");
  });
});

describe("where an upload lands", () => {
  it("is the inbox, which is half weight and never pinned", () => {
    const dir = brain();
    const result = storeUpload(dir, { filename: "notes.md", content: Buffer.from("hello") });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.noteId).toBe("inbox/notes");
    expect(existsSync(join(dir, INBOX, "notes.md"))).toBe(true);
  });

  it("makes the inbox if it is not there yet", () => {
    const dir = brain();
    expect(existsSync(join(dir, INBOX))).toBe(false);
    storeUpload(dir, { filename: "a.md", content: Buffer.from("x") });
    expect(existsSync(join(dir, INBOX))).toBe(true);
  });

  it("cannot be written outside the brain by a crafted name", () => {
    const dir = brain();
    const outside = join(dir, "..", "escaped.md");
    storeUpload(dir, { filename: "../escaped.md", content: Buffer.from("x") });
    expect(existsSync(outside)).toBe(false);
  });
});

describe("what is refused", () => {
  it("an empty file, which is a mistake rather than a document", () => {
    const result = storeUpload(brain(), { filename: "a.md", content: Buffer.alloc(0) });
    expect(result.ok).toBe(false);
  });

  it("anything over the size cap", () => {
    const result = storeUpload(brain(), {
      filename: "a.md",
      content: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(413);
  });

  it("a type the brain cannot do anything with, saying which types it can", () => {
    const result = storeUpload(brain(), { filename: "a.exe", content: Buffer.from("MZ") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(415);
    expect(result.error).toContain(".md");
  });
});
