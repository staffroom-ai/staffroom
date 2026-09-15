// The files a stranger looks for before they trust the project. Missing or empty is
// the same thing to them.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, report } from "./_walk.mjs";

const REQUIRED = [
  "LICENSE",
  "NOTICE",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "ROADMAP.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
];

const hits = [];
for (const f of REQUIRED) {
  try {
    const s = await stat(join(ROOT, f));
    if (s.size < 50) hits.push(`${f}: exists but is ${s.size} bytes`);
  } catch {
    hits.push(`${f}: missing`);
  }
}

report(
  "hygiene-files",
  hits,
  "See docs/specs/repo-quality-launch.md section 7 for what each file should say.",
);
