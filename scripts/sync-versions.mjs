// Copies each package's version from its package.json into its VERSION constant.
//
// Changesets bumps package.json and knows nothing about a string in the source,
// so every release used to leave the two disagreeing until somebody noticed. The
// version-constants lint gate catches it, but catching it means a red main and a
// published package that reports the wrong version from `--version` and /health
// — which is exactly what happened at 0.2.0.
//
// So this runs as part of `changeset version`, inside the Version pull request,
// and the lint gate stays as the backstop rather than the only line of defence.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = ["cli", "core", "server", "templates"];

let changed = 0;

for (const name of PACKAGES) {
  const dir = join(ROOT, "packages", name);
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const file = join(dir, "src", "index.ts");
  const source = await readFile(file, "utf8");

  const updated = source.replace(/(VERSION\s*=\s*)"([^"]+)"/, (whole, prefix, current) =>
    current === manifest.version ? whole : `${prefix}"${manifest.version}"`,
  );

  if (updated === source) continue;
  await writeFile(file, updated, "utf8");
  console.log(`packages/${name}: VERSION is now ${manifest.version}`);
  changed += 1;
}

console.log(
  changed === 0 ? "Every VERSION already matches its package.json." : `Updated ${changed}.`,
);
