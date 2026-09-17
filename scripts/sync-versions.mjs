// Copies each package's version from its package.json into every version
// constant in its source.
//
// Changesets bumps package.json and knows nothing about a string in the source,
// so every release used to leave the two disagreeing until somebody noticed. The
// version-constants lint gate catches it, but catching it means a red main and a
// published package that reports the wrong version from `--version` and /health
// — which is exactly what happened at 0.2.0.
//
// So this runs as part of `changeset version`, inside the Version pull request,
// and the lint gate stays as the backstop rather than the only line of defence.
//
// Every file under src/, not just index.ts: 0.3.0 shipped with a second copy in
// server/src/doctor/index.ts that neither this nor the gate was looking at, so
// the doctor printed 0.2.0 in its telemetry preview.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, walk } from "./lint/_walk.mjs";

const PACKAGES = ["cli", "core", "server", "templates"];
/** `VERSION`, `SERVER_VERSION`, `CLI_VERSION`: any constant whose name ends in it. */
const CONSTANT = /\b([A-Z][A-Z0-9_]*VERSION\s*=\s*)"(\d+\.\d+\.\d+[^"]*)"/g;

let changed = 0;

for (const name of PACKAGES) {
  const dir = join(ROOT, "packages", name);
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const files = await walk(join(dir, "src"), (p) => p.endsWith(".ts") && !p.includes(".test."));

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const updated = source.replace(CONSTANT, (whole, prefix, current) =>
      current === manifest.version ? whole : `${prefix}"${manifest.version}"`,
    );
    if (updated === source) continue;

    await writeFile(file, updated, "utf8");
    console.log(`${rel(file)}: now ${manifest.version}`);
    changed += 1;
  }
}

console.log(
  changed === 0
    ? "Every version constant already matches its package.json."
    : `Updated ${changed}.`,
);
