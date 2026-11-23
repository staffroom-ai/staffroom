// Every version string in a package's source must match its package.json.
//
// The server's goes into /health and the welcome frame, and the CLI's is what
// `npx staffroom --version` prints. Changesets bumps package.json and knows
// nothing about a string in the source, so without this the office reports the
// version it had at the last time somebody remembered.
//
// Every file under src/, not just index.ts. The narrow version of this gate
// missed `SERVER_VERSION` in server/src/doctor/index.ts, whose own comment said
// "the version-constants lint gate keeps it honest" — so 0.3.0 shipped with the
// doctor printing 0.2.0 in the telemetry preview. A second copy of a version is
// the thing this gate exists to catch, and it could not see one.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, report, walk } from "./_walk.mjs";

const PACKAGES = ["cli", "core", "server", "templates"];
/** `VERSION`, `SERVER_VERSION`, `CLI_VERSION`: any constant whose name ends in it. */
const CONSTANT = /\b([A-Z][A-Z0-9_]*VERSION)\s*=\s*"(\d+\.\d+\.\d+[^"]*)"/g;
const hits = [];

for (const name of PACKAGES) {
  const dir = join(ROOT, "packages", name);
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));

  const index = join(dir, "src", "index.ts");
  const indexSource = await readFile(index, "utf8");
  if (!/\bVERSION\s*=\s*"/.test(indexSource)) {
    hits.push(`${rel(index)}: no VERSION constant`);
  }

  const files = await walk(join(dir, "src"), (p) => p.endsWith(".ts") && !p.includes(".test."));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const [, constant, value] of source.matchAll(CONSTANT)) {
      if (value === manifest.version) continue;
      hits.push(`${rel(file)}: ${constant} is ${value}, package.json says ${manifest.version}`);
    }
  }
}

report(
  "version-constants",
  hits,
  "Run `node scripts/sync-versions.mjs`, which copies package.json's version into every one of these.",
);
