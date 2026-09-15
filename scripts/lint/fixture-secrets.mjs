// No real credentials in fixtures or templates. A recorded provider response that
// still carries the key that produced it is a published secret the moment we tag.
import { readFile } from "node:fs/promises";
import { rel, report, walk } from "./_walk.mjs";

const PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an sk- API key"],
  [/\bkey-[A-Za-z0-9_-]{16,}/, "a key- API key"],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/, "a Bearer token"],
];

const files = await walk(
  undefined,
  (p) =>
    (p.includes("fixtures/") || p.startsWith("packages/templates/")) && !p.endsWith(".test.mjs"),
);
const hits = [];

for (const f of files) {
  const lines = (await readFile(f, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const [re, what] of PATTERNS)
      if (re.test(line)) hits.push(`${rel(f)}:${i + 1}: looks like ${what}`);
  });
}

report(
  "fixture-secrets",
  hits,
  "Replace it with a placeholder such as sk-test-REDACTED and rotate the real key now.",
);
