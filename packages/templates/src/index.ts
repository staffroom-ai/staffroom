/**
 * The office templates, and copying one into a new office folder.
 *
 * A template is a folder of plain files. Nothing is generated and nothing is
 * templated: what ships is what the owner gets, which means they can read it
 * before they trust it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.0.1";

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
}

export function copyTemplate(id: string, dest: string, options: CopyOptions = {}): CopyResult {
  const from = templateDir(id);
  mkdirSync(dest, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];

  for (const entry of readdirSync(from)) {
    if (NEVER_COPY.has(entry)) {
      skipped.push(entry);
      continue;
    }
    // Shipped as `gitignore` so npm does not treat it as the package's own.
    const target = entry === "gitignore" ? ".gitignore" : entry;
    cpSync(join(from, entry), join(dest, target), { recursive: true });
    copied.push(target);
  }

  // Demo transcripts go where the server looks for them by default.
  const demoFrom = join(from, "demo-runs");
  if (existsSync(demoFrom)) {
    const demoTo = join(dest, ".staffroom", "demo-runs");
    mkdirSync(demoTo, { recursive: true });
    cpSync(demoFrom, demoTo, { recursive: true });
    copied.push(".staffroom/demo-runs");
  }

  const toolsCopied: string[] = [];
  if (options.includeTools === true) {
    const toolsFrom = exampleToolsDir();
    const toolsTo = join(dest, "tools");
    mkdirSync(toolsTo, { recursive: true });
    for (const entry of readdirSync(toolsFrom).filter((f) => f.endsWith(".ts"))) {
      cpSync(join(toolsFrom, entry), join(toolsTo, entry));
      toolsCopied.push(entry);
    }
  }

  return { dest, copied, skipped, toolsCopied };
}
