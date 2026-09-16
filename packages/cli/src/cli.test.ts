/**
 * The CLI's decisions, tested without spawning it.
 *
 * Which folder counts as "the office" is the single most consequential guess this
 * program makes: getting it wrong means an owner opens a brand-new empty office
 * and believes they have lost their staff. It is worth pinning every branch.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { banner, KEEP_OPEN } from "./banner.js";
import { initOffice, TOOLS_TIP } from "./commands/init.js";
import {
  defaultOfficePath,
  isOffice,
  pointerPath,
  rememberOffice,
  resolveOfficeDir,
} from "./office-dir.js";
import { canOpenBrowser } from "./open-browser.js";

const made: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-cli-"));
  made.push(dir);
  return dir;
}
function asOffice(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agents.yaml"), "version: 1\n", "utf8");
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("finding the office", () => {
  it("prefers --office over everything", () => {
    const flagged = asOffice(join(temp(), "chosen"));
    const cwd = asOffice(join(temp(), "office"));
    const resolved = resolveOfficeDir({ flag: flagged, env: cwd, cwd, home: temp() });
    expect(resolved.dir).toBe(flagged);
    expect(resolved.source).toBe("flag");
  });

  it("takes STAFFROOM_OFFICE when there is no flag", () => {
    const env = asOffice(join(temp(), "from-env"));
    const resolved = resolveOfficeDir({ env, cwd: temp(), home: temp() });
    expect(resolved.dir).toBe(env);
    expect(resolved.source).toBe("env");
  });

  it("finds ./office when it is really an office", () => {
    const base = temp();
    const office = asOffice(join(base, "office"));
    const resolved = resolveOfficeDir({ cwd: base, home: temp() });
    expect(resolved.dir).toBe(office);
    expect(resolved.source).toBe("cwd");
  });

  it("ignores a bare ./office folder that is not one", () => {
    const base = temp();
    mkdirSync(join(base, "office"), { recursive: true });
    const resolved = resolveOfficeDir({ cwd: base, home: temp() });
    expect(resolved.source).toBe("new");
  });

  it("remembers the last office, so the next run from anywhere finds it", () => {
    const home = temp();
    const office = asOffice(join(temp(), "remembered"));
    rememberOffice(office, home);
    const resolved = resolveOfficeDir({ cwd: temp(), home });
    expect(resolved.dir).toBe(office);
    expect(resolved.source).toBe("pointer");
  });

  it("does not open an office the pointer names but that is gone", () => {
    const home = temp();
    mkdirSync(join(home, ".staffroom"), { recursive: true });
    writeFileSync(pointerPath(home), "/nowhere/at/all\n", "utf8");
    const resolved = resolveOfficeDir({ cwd: temp(), home });
    expect(resolved.source).toBe("new");
    expect(resolved.dir).toBe(defaultOfficePath(home));
  });

  it("knows an office by its agents.yaml", () => {
    expect(isOffice(asOffice(join(temp(), "yes")))).toBe(true);
    expect(isOffice(temp())).toBe(false);
  });
});

describe("opening a browser", () => {
  it("does not over SSH: the browser would open on the wrong machine", () => {
    expect(canOpenBrowser({ env: { SSH_CONNECTION: "1" }, platform: "darwin" })).toBe(false);
    expect(canOpenBrowser({ env: { SSH_TTY: "/dev/pts/0" }, platform: "linux" })).toBe(false);
  });

  it("does not in Docker or CI", () => {
    expect(canOpenBrowser({ env: {}, platform: "linux", hasDockerEnv: true })).toBe(false);
    expect(canOpenBrowser({ env: { CI: "true" }, platform: "darwin" })).toBe(false);
  });

  it("does not on a Linux box with no display", () => {
    expect(canOpenBrowser({ env: {}, platform: "linux", hasDockerEnv: false })).toBe(false);
    expect(canOpenBrowser({ env: { DISPLAY: ":0" }, platform: "linux", hasDockerEnv: false })).toBe(
      true,
    );
  });

  it("does on a normal desktop", () => {
    expect(canOpenBrowser({ env: {}, platform: "darwin", hasDockerEnv: false })).toBe(true);
  });

  it("obeys STAFFROOM_NO_OPEN", () => {
    expect(
      canOpenBrowser({ env: { STAFFROOM_NO_OPEN: "1" }, platform: "darwin", hasDockerEnv: false }),
    ).toBe(false);
  });
});

describe("the banner", () => {
  it("says the thing people need to know about terminal windows", () => {
    const text = banner({ url: "http://127.0.0.1:4242/?t=abc", officeDir: "/tmp/o" });
    expect(text).toContain(KEEP_OPEN);
    expect(text).toContain("Office folder: /tmp/o");
    expect(text).toContain("?t=abc");
  });

  it("does not repeat boot's demo explanation", () => {
    const text = banner({ url: "http://x/?t=1", officeDir: "/tmp/o" });
    expect(text).not.toContain("replaying recorded work");
  });
});

describe("init", () => {
  it("creates an office and says you can change it", () => {
    const dir = join(temp(), "made");
    const lines: string[] = [];
    initOffice({ dir }, (line) => lines.push(line));
    expect(isOffice(dir)).toBe(true);
    expect(lines.join("\n")).toContain("You can change everything later");
    expect(lines.join("\n")).not.toContain(TOOLS_TIP);
  });

  it("copies the example tools and points at the TRY IT lines", () => {
    const dir = join(temp(), "with-tools");
    const lines: string[] = [];
    initOffice({ dir, tools: true }, (line) => lines.push(line));
    expect(lines.join("\n")).toContain(TOOLS_TIP);
    expect(lines.join("\n")).toContain("lookup-order.ts");
  });

  it("names the templates that do exist rather than just refusing", () => {
    expect(() => initOffice({ dir: join(temp(), "x"), template: "nope" })).toThrow(
      /no template called nope/,
    );
  });
});
