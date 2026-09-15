// Copies the built web bundle into the server's dist/public so the server can
// serve the office from a single package. Fails loudly: a server published
// without the office in it is a broken release, not a degraded one.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../web/dist");
const to = resolve(here, "../dist/public");

if (!existsSync(from)) {
  console.error(`copy-web: ${from} does not exist. Build @staffroom/web first (pnpm turbo build).`);
  process.exit(1);
}
if ((await readdir(from)).length === 0) {
  console.error(`copy-web: ${from} is empty. The web build produced no output.`);
  process.exit(1);
}
await mkdir(dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copy-web: ${from} -> ${to}`);
