// A pull request that changes a published package carries a changeset, so the
// release notes are written by the person who made the change and not by whoever
// cuts the release. Also refuses a major bump while we are below 1.0.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, report, walk } from "./_walk.mjs";

const base = process.env.CHANGESET_BASE ?? "origin/main";
const hits = [];

let changed = [];
try {
  changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\n")
    .filter(Boolean);
} catch {
  console.log("changeset-present: no git range to compare against, skipping");
  process.exit(0);
}

// `main...HEAD` is empty when HEAD *is* origin/main, which is exactly what happens
// when work is committed straight to main and pushed. The check then passed on
// every commit while an entire week of changes went unrecorded, and the release
// notes would have omitted all of it. On main, compare against the last tag
// instead: the range that actually matters is "everything since the last release".
if (changed.length === 0) {
  let lastTag = "";
  try {
    lastTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // No tags yet: nothing has been released, so there is nothing to compare to.
  }

  if (lastTag !== "") {
    changed = execFileSync("git", ["diff", "--name-only", `${lastTag}...HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  }
}

const touchedPackage = changed.some((f) => f.startsWith("packages/") && !f.includes("/test"));
const addedChangeset = changed.some(
  (f) => f.startsWith(".changeset/") && f.endsWith(".md") && !f.endsWith("README.md"),
);

if (touchedPackage && !addedChangeset) {
  hits.push("a file under packages/ changed but no .changeset/*.md was added");
}

const notes = await walk(
  join(ROOT, ".changeset"),
  (p) => p.endsWith(".md") && !p.endsWith("README.md"),
);
for (const n of notes) {
  if (/:\s*major\s*$/m.test(await readFile(n, "utf8"))) {
    hits.push(`${n.split("/").pop()}: major bump, but every package is below 1.0`);
  }
}

report(
  "changeset-present",
  hits,
  "Run `pnpm changeset`, pick the packages you touched, and write one sentence a user would understand.",
);
