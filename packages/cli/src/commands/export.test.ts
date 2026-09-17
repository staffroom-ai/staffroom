/**
 * Taking the office with you.
 *
 * "Delete this app tomorrow and the work is still yours" is the project's
 * central claim, and it is only true if there is a way to pick everything up.
 * So what matters here is not that the export runs — it is that what comes out
 * is readable without Staffroom, and that it carries no key.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { exportOffice } from "./export.js";
import { templateApply, templateList } from "./template.js";
import { newTool, toolIdOf, tryItLine } from "./tools.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KEY = "sk-ant-EXPORT-SECRET-0123456789";

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-export-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  writeFileSync(join(dir, ".env"), `ANTHROPIC_API_KEY=${KEY}\n`, "utf8");
  mkdirSync(join(dir, ".staffroom", "secrets"), { recursive: true });
  writeFileSync(join(dir, ".staffroom", "secrets", "oauth.json"), '{"token":"hunter2"}', "utf8");
  return dir;
}

const bytesOf = (path: string): string => readFileSync(path).toString("latin1");

describe("exporting an office", () => {
  it("carries no value from .env and no secrets folder", async () => {
    const dir = office();
    // A key pasted into a note, which is the case the walk has to survive.
    writeFileSync(
      join(dir, "brain", "00-about", "oops.md"),
      `---\ntitle: Oops\ncreated: 2026-01-01T00:00:00+11:00\n---\n\nThe key is ${KEY}\n`,
      "utf8",
    );

    const out = join(dir, "export.zip");
    await exportOffice({ officeDir: dir, out }, () => {});

    const bytes = bytesOf(out);
    expect(bytes).not.toContain(KEY);
    expect(bytes).not.toContain("hunter2");
    expect(bytes).not.toContain("ANTHROPIC_API_KEY=");
  });

  it("keeps the notes as markdown, which is the whole promise", async () => {
    const dir = office();
    const out = join(dir, "export.zip");
    const result = await exportOffice({ officeDir: dir, out }, () => {});

    expect(result.files.some((f) => f.startsWith("brain/") && f.endsWith(".md"))).toBe(true);
    // Readable without unzipping, because the entries are stored not deflated.
    expect(bytesOf(out)).toContain("Northlight Studio");
  });

  it("leaves out the caches, which rebuild themselves", async () => {
    const dir = office();
    const result = await exportOffice({ officeDir: dir, out: join(dir, "e.zip") }, () => {});

    expect(result.files).not.toContain("brain.index.sqlite");
    expect(result.files.some((f) => f.startsWith("runs.sqlite"))).toBe(false);
  });

  it("turns the run log into JSON rather than shipping a database", async () => {
    // An archive you need the original software to open is not an escape route.
    const dir = office();
    await exportOffice({ officeDir: dir, out: join(dir, "e.zip") }, () => {});
    expect(bytesOf(join(dir, "e.zip"))).toContain("runs.json");
  });

  it("says in the archive how to pick it up again", async () => {
    const dir = office();
    await exportOffice({ officeDir: dir, out: join(dir, "e.zip") }, () => {});
    const bytes = bytesOf(join(dir, "e.zip"));
    expect(bytes).toContain("npx staffroom start --office");
    expect(bytes).toContain("readable without Staffroom");
  });

  it("includes brain/_private/, because it is the owner's work too", async () => {
    // Deliberate, and said in the README rather than left as a surprise: these
    // notes are never indexed and never read by an agent, but they are still
    // the owner's, and an export that quietly left a folder behind would not be
    // the escape route it claims to be.
    const dir = office();
    const result = await exportOffice({ officeDir: dir, out: join(dir, "e.zip") }, () => {});

    expect(result.files.some((f) => f.startsWith("brain/_private/"))).toBe(true);
    expect(bytesOf(join(dir, "e.zip"))).toContain("_private/ is included");
  });

  it("refuses a folder that is not an office, by name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-export-bare-"));
    dirs.push(dir);
    await expect(exportOffice({ officeDir: dir, out: join(dir, "e.zip") })).rejects.toThrow(
      /no office at/,
    );
  });
});

describe("templates", () => {
  it("lists what there is, with a description each", () => {
    const lines: string[] = [];
    const ids = templateList((line) => lines.push(line));

    expect(ids).toContain("studio");
    expect(lines.join(" ")).toContain("studio");
    expect(lines.join(" ")).toContain("npx staffroom init --template");
  });

  it("lays one down in an empty folder", () => {
    const into = mkdtempSync(join(tmpdir(), "staffroom-apply-"));
    dirs.push(into);
    rmSync(into, { recursive: true, force: true });

    const result = templateApply({ id: "studio", into }, () => {});

    expect(result.copied).toContain("agents.yaml");
    expect(readFileSync(join(into, "agents.yaml"), "utf8")).toContain("Northlight");
  });

  it("refuses a folder that already has an office in it", () => {
    // Merging would either overwrite somebody's staff or leave two files
    // disagreeing about who works there. Neither is a thing to do to a folder
    // on the strength of one command.
    const dir = office();
    expect(() => templateApply({ id: "studio", into: dir }, () => {})).toThrow(/already has/);
  });

  it("refuses a template that is not there, and says what there is", () => {
    const into = join(tmpdir(), "staffroom-apply-nope");
    expect(() => templateApply({ id: "bakery", into }, () => {})).toThrow(/studio/);
  });
});

describe("writing a tool of your own", () => {
  it("writes a file that says what a custom tool can do", () => {
    const dir = office();
    newTool({ officeDir: dir, name: "lookup-thing" }, () => {});

    const source = readFileSync(join(dir, "tools", "lookup-thing.ts"), "utf8");
    // The warning is in the file, where the person who needs it is looking.
    expect(source).toContain("runs inside Staffroom on your computer");
    expect(source).toContain("paste tool files from the internet");
  });

  it("names the tool the way an agent would call it", () => {
    expect(toolIdOf("lookup-thing")).toBe("lookup_thing");
    expect(toolIdOf("Send SMS")).toBe("send_sms");
  });

  it("defaults to read, and takes write when asked", () => {
    const dir = office();
    newTool({ officeDir: dir, name: "a" }, () => {});
    newTool({ officeDir: dir, name: "b", scope: "write" }, () => {});

    expect(readFileSync(join(dir, "tools", "a.ts"), "utf8")).toContain('scope: "read"');
    expect(readFileSync(join(dir, "tools", "b.ts"), "utf8")).toContain('scope: "write"');
  });

  it("never writes over a file that is already there", () => {
    // This is the owner's code. A command that quietly replaced an afternoon's
    // work for the sake of a stub would be unforgivable.
    const dir = office();
    newTool({ officeDir: dir, name: "mine" }, () => {});
    expect(() => newTool({ officeDir: dir, name: "mine" }, () => {})).toThrow(/already exists/);
  });

  it("tells them it runs with their permissions", () => {
    const lines: string[] = [];
    newTool({ officeDir: office(), name: "thing" }, (line) => lines.push(line));
    expect(lines.join(" ")).toContain("runs on this machine with your permissions");
  });
});

describe("the TRY IT line", () => {
  it("is found in a shipped example's header", () => {
    expect(tryItLine(" * TRY IT: What is the status of order 1002?")).toBe(
      "What is the status of order 1002?",
    );
  });

  it("is found after a line comment too", () => {
    expect(tryItLine("// TRY IT: Text Marta the banners are ready")).toBe(
      "Text Marta the banners are ready",
    );
  });

  it("is absent rather than invented when a file has none", () => {
    expect(tryItLine("export default {}")).toBeUndefined();
  });
});
