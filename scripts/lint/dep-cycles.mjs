// The dependency direction is one way: web -> core (types only), server -> core,
// cli -> server + templates, templates -> nothing. A cycle makes the build order
// undefined and the packages unpublishable separately.
//
// devDependencies edges are ignored on purpose: server devDepends on web to get the
// build order right, and that carries no runtime import. The second check below is
// what actually enforces that nothing in server's source imports web.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, report, walk } from "./_walk.mjs";

const manifests = await walk(
  join(ROOT, "packages"),
  (p) => p.endsWith("package.json") && p.split("/").length === 3,
);
const graph = new Map();

for (const m of manifests) {
  const pkg = JSON.parse(await readFile(m, "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {}).filter(
    (d) => d === "staffroom" || d.startsWith("@staffroom/"),
  );
  graph.set(pkg.name, deps);
}

const hits = [];
const state = new Map();

function visit(node, trail) {
  if (state.get(node) === "done") return;
  if (state.get(node) === "open") {
    hits.push(`cycle: ${[...trail, node].join(" -> ")}`);
    return;
  }
  state.set(node, "open");
  for (const d of graph.get(node) ?? []) if (graph.has(d)) visit(d, [...trail, node]);
  state.set(node, "done");
}

for (const n of graph.keys()) visit(n, []);

// server must not import web at runtime, only copy its build output.
const serverSrc = await walk(join(ROOT, "packages/server/src"), (p) => p.endsWith(".ts"));
for (const f of serverSrc) {
  const text = await readFile(f, "utf8");
  if (/from\s+["']@staffroom\/web["']/.test(text))
    hits.push(`${rel(f)}: imports @staffroom/web at runtime`);
}

report("dep-cycles", hits, "Break the cycle, or move the shared code into @staffroom/core.");
