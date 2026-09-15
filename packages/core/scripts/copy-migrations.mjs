// tsup bundles JavaScript, not SQL. The migrations are read at runtime, so they
// have to reach dist/ or a published @staffroom/core cannot open a run log.
import { cp, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../src/runtime/migrations");
const to = resolve(here, "../dist/runtime/migrations");

const files = await readdir(from);
if (files.filter((f) => f.endsWith(".sql")).length === 0) {
  console.error(`copy-migrations: no .sql files in ${from}`);
  process.exit(1);
}
await cp(from, to, { recursive: true });
console.log(`copy-migrations: ${files.length} file(s) -> dist/runtime/migrations`);
