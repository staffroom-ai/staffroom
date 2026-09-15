// tsup bundles JavaScript, not SQL. The migrations are read at runtime, so they
// have to reach dist/ or a published @staffroom/core cannot open a run log.
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../src/runtime/migrations");
// Two destinations on purpose. tsup flattens the bundle to dist/index.js, so at
// runtime import.meta.url resolves to dist/ and the code looks for dist/migrations.
// The nested path mirrors the source layout for anyone reading dist by hand.
const destinations = [
  resolve(here, "../dist/migrations"),
  resolve(here, "../dist/runtime/migrations"),
];

const files = await readdir(from);
if (files.filter((f) => f.endsWith(".sql")).length === 0) {
  console.error(`copy-migrations: no .sql files in ${from}`);
  process.exit(1);
}
for (const to of destinations) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}
console.log(
  `copy-migrations: ${files.length} file(s) -> dist/migrations and dist/runtime/migrations`,
);
