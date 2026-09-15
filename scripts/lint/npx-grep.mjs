// Every user-facing string tells people to run `npx staffroom <sub>`, never a bare
// `staffroom <sub>`. Most of our users have not installed anything globally, and a
// bare command sends them to "command not found". server-cli-runtime.md section 8.
import { readFile } from "node:fs/promises";
import { rel, report, walk } from "./_walk.mjs";

const BAD = /\b(Run|run|Try|try)\s+`?staffroom\s/;
// Test files are skipped: they legitimately quote the bad string to assert against it.
const files = await walk(
  undefined,
  (p) => p.startsWith("packages/") && /\.(ts|tsx|mjs)$/.test(p) && !/\.test\.[a-z]+$/.test(p),
);
const hits = [];

for (const f of files) {
  const lines = (await readFile(f, "utf8")).split("\n");
  lines.forEach((line, i) => {
    if (BAD.test(line) && !line.includes("npx staffroom"))
      hits.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
  });
}

report(
  "npx-grep",
  hits,
  'Write "npx staffroom <sub>" instead. Users have not installed the CLI globally.',
);
