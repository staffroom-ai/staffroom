// Every HTTP and WebSocket route gets a test next to it. The protocol table in
// server-cli-runtime.md section 6 is the contract with the web package, and an
// untested route is how that contract drifts.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, report, walk } from "./_walk.mjs";

const dir = join(ROOT, "packages/server/src/http");
let routes = [];
try {
  routes = await walk(dir, (p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
} catch {
  console.log("route-tests: no packages/server/src/http yet, nothing to check");
  process.exit(0);
}

const hits = [];
for (const r of routes) {
  const sibling = r.replace(/\.ts$/, ".test.ts");
  try {
    await access(sibling);
  } catch {
    hits.push(`${rel(r)}: no sibling ${rel(sibling).split("/").pop()}`);
  }
}

report(
  "route-tests",
  hits,
  "Add the sibling test file. A route without one is a protocol change nobody checked.",
);
