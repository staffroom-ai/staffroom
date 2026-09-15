/**
 * Loading the owner's own tools from office/tools/*.ts.
 *
 * This is how a business owner (usually with an AI's help) wires in their own
 * database or internal API without publishing an MCP server. It is also the one
 * place arbitrary code from outside the package runs, so the failure mode matters
 * more than the happy path: a file that will not compile, or throws while loading,
 * must produce a card the owner can act on and leave the office running.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { Tool } from "./tool.js";

export interface LoadedTool {
  tool: Tool;
  file: string;
}

export interface LoadFailure {
  file: string;
  message: string;
}

export interface LoadResult {
  tools: LoadedTool[];
  failures: LoadFailure[];
}

/**
 * Our own entry, as a file URL. Absolute so a bundled tool finds it wherever the
 * cache sits, and a URL rather than a path so it works on Windows too.
 */
const CORE_ENTRY = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of ["../index.js", "../index.ts"]) {
    const path = resolve(here, candidate);
    if (existsSync(path)) return pathToFileURL(path).href;
  }
  return pathToFileURL(resolve(here, "../index.js")).href;
})();

/**
 * The default cache folder, inside this package.
 *
 * Location is load-bearing. Everything a tool imports stays external so it shares
 * the office's own zod and `tool()` rather than getting a second copy the registry
 * cannot introspect. External imports are bare specifiers, and a bare specifier
 * only resolves if Node can walk up to a node_modules that has it. Writing the
 * bundle here means that walk always succeeds, on every platform, with no path
 * rewriting to get wrong.
 */
const DEFAULT_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), "../../.tools-cache");

/** Only @staffroom/core needs rewriting: a package cannot reliably import itself. */
const coreAlias = {
  name: "staffroom-core-alias",
  setup(build: {
    onResolve: (o: { filter: RegExp }, cb: () => { path: string; external: boolean }) => void;
  }) {
    build.onResolve({ filter: /^@staffroom\/core(\/.*)?$/ }, () => ({
      path: CORE_ENTRY,
      external: true,
    }));
  },
};

async function loadOne(file: string, outDir: string): Promise<Tool> {
  const outfile = join(outDir, `${basename(file, ".ts")}-${Date.now()}.mjs`);

  await build({
    entryPoints: [file],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    // Anything else the tool imports resolves in the server's own process, so a
    // tool can use what the office already depends on.
    packages: "external",
    plugins: [coreAlias as never],
    logLevel: "silent",
  });

  const module = (await import(pathToFileURL(outfile).href)) as { default?: unknown };
  const exported = module.default;
  if (exported === null || typeof exported !== "object") {
    throw new Error("the file has no default export. End it with `export default tool({ ... })`.");
  }
  const candidate = exported as Partial<Tool>;
  if (typeof candidate.name !== "string" || typeof candidate.run !== "function") {
    throw new Error(
      "the default export is not a tool. Build it with `tool({ ... })` from @staffroom/core.",
    );
  }
  return exported as Tool;
}

export interface LoadToolsOptions {
  dir: string;
  /** Where the bundled output goes. Defaults to a temp folder. */
  cacheDir?: string;
}

/**
 * Loads every .ts file in the folder. One bad file never stops the others: each
 * failure is reported and the rest still load.
 */
export async function loadCustomTools(options: LoadToolsOptions): Promise<LoadResult> {
  const tools: LoadedTool[] = [];
  const failures: LoadFailure[] = [];

  let entries: string[];
  try {
    entries = readdirSync(options.dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  } catch {
    // No tools folder is the normal case for a fresh office.
    return { tools, failures };
  }

  const outDir = options.cacheDir ?? DEFAULT_CACHE;
  await mkdir(outDir, { recursive: true });

  for (const entry of entries.sort()) {
    const file = resolve(options.dir, entry);
    try {
      const loaded = await loadOne(file, outDir);
      tools.push({
        // The loader stamps the source; an author cannot claim to be a built-in.
        tool: { ...loaded, source: { kind: "custom", file: entry } } as Tool,
        file: entry,
      });
    } catch (error) {
      failures.push({
        file: entry,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { tools, failures };
}
