// Keeps three.js out of the first download.
//
// three, fiber and drei are about 1.4 MB raw — more than four fifths of the web
// bundle. A visitor on a phone, or anyone in the list view, never renders a frame
// of it, so they must never download it either: App.tsx loads scene/Scene.js
// through a dynamic import so it lands in its own chunk.
//
// The way that regresses is silent. Someone imports a colour or a constant from
// a scene module into the interface, three comes along for the ride, and the main
// chunk quietly triples while every test stays green. So the boundary is checked
// as a source-level fact, which is fast and names the offending import.
//
// scene/palette.ts is the deliberate exception: plain hex strings, no three.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, rel, report, walk } from "./_walk.mjs";

const WEB_SRC = join(ROOT, "packages", "web", "src");
const SCENE = join(WEB_SRC, "scene");

const files = (await walk(WEB_SRC, (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))).filter(
  (f) => !f.startsWith(SCENE),
);

const hits = [];

for (const file of files) {
  const text = await readFile(file, "utf8");

  if (/from\s+["']three["']|from\s+["']@react-three\//.test(text)) {
    hits.push(`${rel(file)}: imports the renderer directly`);
  }

  for (const match of text.matchAll(/^import[^;]*from\s+["'](.*?scene\/.*?)["']/gm)) {
    if (match[1].endsWith("palette.js")) continue;
    hits.push(`${rel(file)}: statically imports ${match[1]}`);
  }
}

const app = await readFile(join(WEB_SRC, "App.tsx"), "utf8");
if (!/import\(["']\.\/scene\/Scene\.js["']\)/.test(app)) {
  hits.push("packages/web/src/App.tsx: no dynamic import of scene/Scene.js");
}
const palette = await readFile(join(SCENE, "palette.ts"), "utf8");
if (/from\s+["']three["']/.test(palette)) {
  hits.push("packages/web/src/scene/palette.ts: must stay free of three");
}

report(
  "scene-split",
  hits,
  "Take colours from scene/palette.js, which has no three import, or load the module dynamically. Everything the interface imports ships to every visitor.",
);
