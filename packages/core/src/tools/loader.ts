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
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
 * Our own entry, as an absolute file URL the bundled output can import. In the
 * published package this is dist/index.js; running from source under vitest it is
 * src/index.ts, so both are tried.
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
 * Keeps imports external but rewrites them to absolute URLs resolved from this
 * process.
 *
 * External alone is not enough. The bundle is written to a cache folder with no
 * node_modules above it, so a bare specifier there resolves to nothing. Resolving
 * from here means a tool gets the same zod, and the same `tool()`, that the
 * registry uses: a second copy of zod would produce schemas our registry cannot
 * introspect.
 *
 * Anything that cannot be resolved is left bare, so esbuild bundles it instead and
 * the tool still works.
 */
const resolveFromServer = {
  name: "staffroom-resolve-externals",
  setup(build: {
    onResolve: (
      o: { filter: RegExp },
      cb: (a: { path: string }) => { path: string; external: boolean } | undefined,
    ) => void;
  }) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (/^@staffroom\/core(\/.*)?$/.test(args.path)) return { path: CORE_ENTRY, external: true };
      if (args.path.startsWith("node:")) return { path: args.path, external: true };
      try {
        return { path: import.meta.resolve(args.path), external: true };
      } catch {
        return undefined;
      }
    });
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
    plugins: [resolveFromServer as never],
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

  const outDir = options.cacheDir ?? (await mkdtemp(join(tmpdir(), "staffroom-tools-")));

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

  // Make sure the folder exists next time even if it was empty this time.
  await writeFile(join(outDir, ".keep"), "", "utf8").catch(() => undefined);
  return { tools, failures };
}
