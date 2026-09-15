// Guards the licence decision: Staffroom is Apache-2.0, so it must never depend
// on @anthropic-ai/claude-agent-sdk, which is proprietary ("all rights reserved",
// subject to Anthropic's own terms). The agent loop is ours. See
// docs/specs/core-agent-loop.md and CONTRIBUTING.md.
//
// @anthropic-ai/sdk (MIT) IS allowed: it is the plain provider client.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SELF = "scripts/lint/forbidden-sdk.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const FORBIDDEN = ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"];
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".turbo", "docs"]);

const hits = [];

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p);
    } else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(e.name) && e.name !== "pnpm-lock.yaml") {
      const rel = relative(ROOT, p);
      if (rel === SELF) continue;
      const text = await readFile(p, "utf8");
      for (const needle of FORBIDDEN) {
        if (text.includes(needle)) hits.push(`${rel}: ${needle}`);
      }
    }
  }
}

await walk(ROOT);

if (hits.length > 0) {
  console.error(
    "Forbidden dependency found. Staffroom must not use Anthropic's proprietary agent SDK:",
  );
  for (const h of hits) console.error(`  ${h}`);
  console.error("\nUse @anthropic-ai/sdk (MIT) and our own agent loop instead.");
  process.exit(1);
}
console.log("forbidden-sdk: clean");
