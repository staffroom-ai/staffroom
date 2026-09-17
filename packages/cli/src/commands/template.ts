/**
 * Listing the offices you can start from, and laying one down.
 *
 * `init` makes a new office; this is for the other cases — seeing what is on
 * offer before committing to one, and applying a template into a folder that
 * already exists.
 *
 * `apply` refuses to write over anything. A template is a starting point, and
 * the person running this on a folder with their own work in it is somebody who
 * would rather be told than tidied up after.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { copyTemplate, listTemplates } from "@staffroom/templates";

export function templateList(log: (line: string) => void = console.log): string[] {
  const templates = listTemplates();

  log("");
  for (const template of templates) {
    log(`  ${template.id.padEnd(12)} ${template.label}`);
    log(`  ${" ".repeat(12)} ${template.description}`);
    log("");
  }
  log("  npx staffroom init --template <id>");
  log("");

  return templates.map((t) => t.id);
}

export interface ApplyOptions {
  id: string;
  into: string;
  includeTools?: boolean;
}

export interface ApplyResult {
  copied: string[];
  toolsCopied: string[];
  skipped: string[];
}

/** The files a template would write, which is what an existing folder is checked against. */
function wouldWrite(into: string): string[] {
  try {
    return readdirSync(into);
  } catch {
    return [];
  }
}

export function templateApply(
  options: ApplyOptions,
  log: (line: string) => void = console.log,
): ApplyResult {
  const known = listTemplates().map((t) => t.id);
  if (!known.includes(options.id)) {
    throw new Error(`There is no template called ${options.id}. There is: ${known.join(", ")}.`);
  }

  /*
   * Refused rather than merged.
   *
   * Merging a template into an office that already has an agents.yaml would
   * either overwrite the owner's staff or leave two files disagreeing about who
   * works there. Neither is something to do to somebody's folder on the strength
   * of one command, and the folder they meant is almost always a new one.
   */
  const existing = wouldWrite(options.into);
  const clashes = ["agents.yaml", "config.yaml", "brain"].filter((name) => existing.includes(name));
  if (clashes.length > 0) {
    throw new Error(
      `${options.into} already has ${clashes.join(", ")} in it. ` +
        "Pick an empty folder, or move what is there first.",
    );
  }

  const result = copyTemplate(options.id, options.into, {
    ...(options.includeTools === undefined ? {} : { includeTools: options.includeTools }),
  });

  log("");
  log(`  Laid down ${options.id} in ${options.into}`);
  log(`  ${result.copied.length} file(s).`);

  if (result.toolsCopied.length > 0) {
    log("");
    log(`  ${result.toolsCopied.length} example tool(s). They run on this machine.`);
  }

  if (result.skipped.length > 0) {
    // Named, because the two things copyTemplate refuses are the two somebody
    // would most notice missing: a tools/ folder that runs code, and the
    // office's own .staffroom/ notes to itself.
    log("");
    log(`  Not copied: ${result.skipped.join(", ")}`);
  }

  log("");
  log(`  npx staffroom start --office ${options.into}`);
  log("");

  return {
    copied: result.copied,
    toolsCopied: result.toolsCopied,
    skipped: result.skipped,
  };
}

/** Whether a folder looks like an office already, for callers that want to ask. */
export function looksLikeOffice(dir: string): boolean {
  return existsSync(join(dir, "agents.yaml"));
}
