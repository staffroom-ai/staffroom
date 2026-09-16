/**
 * Working out which folder is "the office".
 *
 * A business owner types `npx staffroom` in whatever directory their terminal
 * happened to open in, so guessing well matters more here than almost anywhere
 * else. The order is: what they said, what they configured, what is in front of
 * them, what they used last, and only then a new one.
 *
 * The pointer file is what makes the second run work from anywhere. Without it
 * the CLI would create a second office beside the first and the owner would lose
 * their staff without being told anything went wrong.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Where we remember the office the owner used last. */
export function pointerPath(home: string = homedir()): string {
  return join(home, ".staffroom", "current-office");
}

/** Where a first run puts an office when nothing else exists. */
export function defaultOfficePath(home: string = homedir()): string {
  return join(home, "Staffroom", "office");
}

/** A folder is an office when it holds the one file the office cannot run without. */
export function isOffice(dir: string): boolean {
  return existsSync(join(dir, "agents.yaml"));
}

export interface ResolveOptions {
  flag?: string | undefined;
  env?: string | undefined;
  cwd?: string;
  home?: string;
}

export interface Resolved {
  dir: string;
  /** How we got here, so the CLI can say so rather than silently choosing. */
  source: "flag" | "env" | "cwd" | "pointer" | "new";
  exists: boolean;
}

export function resolveOfficeDir(options: ResolveOptions = {}): Resolved {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();

  if (options.flag !== undefined && options.flag.length > 0) {
    const dir = resolve(cwd, options.flag);
    return { dir, source: "flag", exists: isOffice(dir) };
  }

  if (options.env !== undefined && options.env.length > 0) {
    const dir = resolve(cwd, options.env);
    return { dir, source: "env", exists: isOffice(dir) };
  }

  // Only when it is really an office: a bare ./office folder someone made for
  // something else should not be adopted.
  const here = join(cwd, "office");
  if (isOffice(here)) return { dir: here, source: "cwd", exists: true };
  if (isOffice(cwd)) return { dir: cwd, source: "cwd", exists: true };

  const pointer = pointerPath(home);
  if (existsSync(pointer)) {
    const remembered = readFileSync(pointer, "utf8").trim();
    // A remembered office that has since been deleted is not an answer. Falling
    // through to a new one is better than starting in a folder that is not there.
    if (remembered.length > 0 && isOffice(remembered)) {
      return { dir: remembered, source: "pointer", exists: true };
    }
  }

  return { dir: defaultOfficePath(home), source: "new", exists: false };
}

/** Remember this office, so the next run from anywhere finds it again. */
export function rememberOffice(dir: string, home: string = homedir()): void {
  const path = pointerPath(home);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${dir}\n`, "utf8");
  } catch {
    // Not being able to remember is not worth failing a start over; the owner
    // can always pass --office.
  }
}
