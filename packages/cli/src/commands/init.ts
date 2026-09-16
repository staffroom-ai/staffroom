/**
 * Making an office folder.
 *
 * The tree is printed because the whole promise of the product is that this is
 * yours, on your disk, in files you can open. Showing it is the fastest way to
 * make that true rather than claimed.
 */
import { copyTemplate, listTemplates, TEMPLATE_IDS } from "@staffroom/templates";

export interface InitOptions {
  template?: string;
  dir?: string;
  tools?: boolean;
  cwd?: string;
}

export const TOOLS_TIP =
  "Tip: the example tools each have a TRY IT line you can type in demo mode.";

export function templateChoices(): string {
  return listTemplates()
    .map((t) => `  ${t.label} — ${t.description}`)
    .join("\n");
}

export function initOffice(
  options: InitOptions,
  log: (line: string) => void = console.log,
): string {
  const template = options.template ?? "studio";
  if (!TEMPLATE_IDS.includes(template)) {
    throw new Error(`There is no template called ${template}. Available:\n${templateChoices()}`);
  }

  const dest = options.dir ?? "office";
  const result = copyTemplate(template, dest, { includeTools: options.tools === true });

  log("");
  log(`  Created ${result.dest}`);
  log("");
  for (const entry of result.copied) log(`    ${entry}`);
  if (result.toolsCopied.length > 0) {
    log("    tools/");
    for (const entry of result.toolsCopied) log(`      ${entry}`);
  }
  log("");
  log("  You can change everything later in the office folder.");
  if (result.toolsCopied.length > 0) log(`  ${TOOLS_TIP}`);
  log("");

  return result.dest;
}
