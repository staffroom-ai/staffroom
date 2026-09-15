// Guards the licence decision: Staffroom is Apache-2.0, so it must never depend on
// @anthropic-ai/claude-agent-sdk, which is proprietary ("all rights reserved",
// subject to Anthropic's own terms). The agent loop is ours and the licence depends
// on keeping it that way. See docs/specs/core-agent-loop.md and CONTRIBUTING.md.
//
// @anthropic-ai/sdk (MIT) IS allowed: it is the plain provider client.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, report, walk } from "./_walk.mjs";

const FORBIDDEN = ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"];
const SELF = "scripts/lint/forbidden-sdk.mjs";

const files = await walk(
  undefined,
  (p) => p !== SELF && (p.endsWith("package.json") || /\.(ts|tsx|js|mjs|cjs)$/.test(p)),
);
files.push(join(ROOT, "pnpm-lock.yaml"));

const hits = [];
for (const f of files) {
  let text;
  try {
    text = await readFile(f, "utf8");
  } catch {
    continue;
  }
  for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${rel(f)}: ${needle}`);
}

report(
  "forbidden-sdk",
  hits,
  "Use @anthropic-ai/sdk (MIT) and our own agent loop instead. This is a licence rule, not a preference.",
);
