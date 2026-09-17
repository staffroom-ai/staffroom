/**
 * The office templates, and copying one into a new office folder.
 *
 * A template is a folder of plain files. Nothing is generated and nothing is
 * templated: what ships is what the owner gets, which means they can read it
 * before they trust it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.3.0";

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
}

/** studio is first: it is what `npx staffroom init` uses when nothing is chosen. */
export const TEMPLATES: TemplateInfo[] = [
  {
    id: "studio",
    label: "Design studio",
    description:
      "A four-person studio with marketing, finance and sales. The one the demo runs on.",
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

/** Works from src during development and from dist once built. */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, ".."), resolve(here, "../..")]) {
    if (existsSync(join(candidate, "studio", "agents.yaml"))) return candidate;
  }
  return resolve(here, "..");
}

export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.filter((t) => existsSync(join(packageRoot(), t.id, "agents.yaml")));
}

export function templateDir(id: string): string {
  const dir = join(packageRoot(), id);
  if (!existsSync(join(dir, "agents.yaml"))) {
    throw new Error(`There is no template called "${id}". Try one of: ${TEMPLATE_IDS.join(", ")}.`);
  }
  return dir;
}

/** The five example tools, which only reach an office when asked for. */
export function exampleToolsDir(): string {
  return join(packageRoot(), "tools");
}

/** Never copied into an office: these belong to the repository, not the owner. */
const NEVER_COPY = new Set([
  "package.json",
  // Copied below, into .staffroom rather than the office root.
  "sample-run.json",
  "node_modules",
  "tools",
  ".staffroom",
  "demo-runs",
  "src",
  "dist",
]);

export interface CopyOptions {
  /** Also copy the five example tools into <dest>/tools/. */
  includeTools?: boolean;
}

export interface CopyResult {
  dest: string;
  copied: string[];
  skipped: string[];
  toolsCopied: string[];
  /** Files that were already there, left exactly as they were. */
  kept: string[];
}

/**
 * Copies a tree without ever writing over a file that is already there.
 *
 * `cpSync` overwrites by default, and this runs against the folder somebody
 * pointed `--office` at. If they had a `brain/00-about/pricing.md`, laying the
 * studio template down replaced it with ours — silently, because the template
 * ships a file at that exact path. Three years of pricing decisions, gone to a
 * mistyped flag.
 *
 * Nothing here needs to overwrite anything. A template is a starting point, and
 * the files it would have written are the ones the owner has already written
 * better.
 */
function copyNew(from: string, to: string, at: string, into: CopyResult): void {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      copyNew(join(from, entry), join(to, entry), `${at}/${entry}`, into);
    }
    return;
  }

  if (existsSync(to)) {
    into.kept.push(at);
    return;
  }

  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  into.copied.push(at);
}

export function copyTemplate(id: string, dest: string, options: CopyOptions = {}): CopyResult {
  const from = templateDir(id);
  mkdirSync(dest, { recursive: true });

  const result: CopyResult = { dest, copied: [], skipped: [], toolsCopied: [], kept: [] };

  for (const entry of readdirSync(from)) {
    if (NEVER_COPY.has(entry)) {
      result.skipped.push(entry);
      continue;
    }
    // Shipped as `gitignore` so npm does not treat it as the package's own.
    const target = entry === "gitignore" ? ".gitignore" : entry;
    copyNew(join(from, entry), join(dest, target), target, result);
  }

  // The run that already happened, next to the transcripts: ours, not the
  // owner's, so it does not sit in their office folder looking like a file they
  // are supposed to edit.
  const seedFrom = join(from, "sample-run.json");
  if (existsSync(seedFrom)) {
    mkdirSync(join(dest, ".staffroom"), { recursive: true });
    copyNew(
      seedFrom,
      join(dest, ".staffroom", "sample-run.json"),
      ".staffroom/sample-run.json",
      result,
    );
  }

  // Demo transcripts go where the server looks for them by default.
  const demoFrom = join(from, "demo-runs");
  if (existsSync(demoFrom)) {
    copyNew(demoFrom, join(dest, ".staffroom", "demo-runs"), ".staffroom/demo-runs", result);
  }

  if (options.includeTools === true) {
    const toolsFrom = exampleToolsDir();
    const toolsTo = join(dest, "tools");
    mkdirSync(toolsTo, { recursive: true });
    for (const entry of readdirSync(toolsFrom).filter((f) => f.endsWith(".ts"))) {
      // A tool file is the owner's code the moment they have edited it.
      if (existsSync(join(toolsTo, entry))) {
        result.kept.push(`tools/${entry}`);
        continue;
      }
      cpSync(join(toolsFrom, entry), join(toolsTo, entry));
      result.toolsCopied.push(entry);
    }
  }

  return result;
}
