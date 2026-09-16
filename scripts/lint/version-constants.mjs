// Each package exports a VERSION constant, and it must match its package.json.
//
// The server's goes into /health and the welcome frame, and the CLI's is what
// `npx staffroom --version` prints. Changesets bumps package.json and knows
// nothing about a string in the source, so without this the office reports the
// version it had at the last time somebody remembered.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, report } from "./_walk.mjs";

const PACKAGES = ["cli", "core", "server", "templates"];
const hits = [];

for (const name of PACKAGES) {
  const dir = join(ROOT, "packages", name);
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const source = await readFile(join(dir, "src", "index.ts"), "utf8");

  const found = /VERSION\s*=\s*"([^"]+)"/.exec(source);
  if (found === null) {
    hits.push(`${rel(join(dir, "src", "index.ts"))}: no VERSION constant`);
    continue;
  }
  if (found[1] !== manifest.version) {
    hits.push(
      `${rel(join(dir, "src", "index.ts"))}: VERSION is ${found[1]}, package.json says ${manifest.version}`,
    );
  }
}

report(
  "version-constants",
  hits,
  "Update the VERSION constant to match package.json after a version bump.",
);
