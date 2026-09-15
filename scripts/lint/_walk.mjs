// Shared directory walk for the guard scripts. Skips build output and vendored code.
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".turbo",
  "test-results",
  "playwright-report",
]);

export async function walk(dir = ROOT, filter = () => true) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, filter)));
    else if (filter(relative(ROOT, p))) out.push(p);
  }
  return out;
}

export const rel = (p) => relative(ROOT, p);

export function report(name, hits, explain) {
  if (hits.length === 0) {
    console.log(`${name}: clean`);
    return;
  }
  console.error(`${name}: ${hits.length} problem${hits.length === 1 ? "" : "s"}`);
  for (const h of hits) console.error(`  ${h}`);
  console.error(`\n${explain}`);
  process.exit(1);
}
