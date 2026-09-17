/**
 * The reference pages, written from the code rather than by hand.
 *
 * Every page in `src/content/docs/reference/` that this writes is a page nobody
 * maintains. That is the point: a settings reference kept by hand is wrong
 * within a release, and wrong documentation about a config key is worse than
 * none — somebody types what it says, the office refuses it, and they conclude
 * the office is broken.
 *
 * So `ConfigSchema`, `AgentsFileSchema`, `RUN_ERROR_CODES` and `userMessage` are
 * the source, and `--check` fails CI when the committed output has drifted from
 * them. A PR that adds a config key and does not run this is a PR that does not
 * merge.
 *
 * Every key gets an example. A key documented as "string" tells somebody
 * nothing they could not guess; a key documented with a line they can paste
 * into their own file is the whole reason to look it up.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentsFileSchema, ConfigSchema, RUN_ERROR_CODES, userMessage } from "@staffroom/core";
import { z } from "zod";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "content", "docs", "reference");

const CHECK = process.argv.includes("--check");

const BANNER =
  "<!-- Written by pnpm docs:gen from the schemas in packages/core. Do not edit by hand. -->";

/**
 * An example value for a key, in the shape somebody would actually write.
 *
 * A default is the best example there is: it is both correct and what the
 * office is already doing. Failing that, the type decides, and an enum shows
 * its first member rather than the word "string".
 */
function exampleFor(node) {
  if (node.default !== undefined) return JSON.stringify(node.default);
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) return JSON.stringify(node.enum[0]);
  if (Array.isArray(node.anyOf)) {
    // A union of literals is a version number: show the newest, which is what
    // somebody writing a new file should put.
    const consts = node.anyOf.map((n) => n.const).filter((v) => v !== undefined);
    if (consts.length > 0) return JSON.stringify(consts[consts.length - 1]);
    const first = node.anyOf.find((n) => n.type !== undefined);
    if (first !== undefined) return exampleFor(first);
  }
  if (node.type === "boolean") return "false";
  if (node.type === "integer" || node.type === "number") {
    if (typeof node.minimum === "number") return String(node.minimum);
    return "1";
  }
  if (node.type === "array") return "[]";
  if (node.type === "object") return "{}";
  return '"..."';
}

/** What the office will accept, in a sentence rather than a JSON Schema fragment. */
function constraintOf(node) {
  const parts = [];
  if (Array.isArray(node.enum)) parts.push(`one of ${node.enum.map((v) => `\`${v}\``).join(", ")}`);
  if (typeof node.minimum === "number" && typeof node.maximum === "number") {
    parts.push(`${node.minimum} to ${node.maximum}`);
  } else if (typeof node.minimum === "number") {
    parts.push(`${node.minimum} or more`);
  } else if (typeof node.maximum === "number") {
    parts.push(`up to ${node.maximum}`);
  }
  if (typeof node.minLength === "number" && node.minLength > 0) parts.push("not empty");
  if (typeof node.pattern === "string") parts.push(`matching \`${node.pattern}\``);
  return parts.join(", ");
}

function typeOf(node) {
  if (Array.isArray(node.enum)) return "string";
  if (node.type === "object" && node.additionalProperties) return "map";
  if (Array.isArray(node.anyOf)) {
    const types = node.anyOf.map((n) => (n.const === undefined ? typeOf(n) : typeof n.const));
    return [...new Set(types)].join(" or ");
  }
  return node.type ?? "any";
}

/**
 * Every leaf key, as `a.b.c`, depth first and in the order the schema declares.
 *
 * Declared order rather than alphabetical: the schema is written in the order
 * somebody reads the file, and sorting it would scatter related settings.
 */
function walk(node, prefix = "") {
  const rows = [];
  const properties = node.properties ?? {};
  const needed = new Set(node.required ?? []);

  for (const [key, child] of Object.entries(properties)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    const isObject = child.type === "object" && child.properties !== undefined;
    const itemProperties =
      child.type === "array" && child.items?.type === "object" ? child.items : undefined;

    if (isObject) {
      // A block header, then its keys. The header itself is not a settable key.
      rows.push({ path, type: "block", example: "", constraint: "", required: false });
      rows.push(...walk(child, path));
      continue;
    }

    if (itemProperties !== undefined) {
      /*
       * A list of objects — `agents` is the one that matters.
       *
       * Its fields are the most-read part of the whole reference and would
       * otherwise be one row saying "array", which tells nobody what to write
       * in it. `agents[].id` is how somebody would say it out loud.
       */
      rows.push({ path, type: "list of", example: "", constraint: "", required: needed.has(key) });
      rows.push(...walk(itemProperties, `${path}[]`));
      continue;
    }

    rows.push({
      path,
      type: typeOf(child),
      example: exampleFor(child),
      constraint: constraintOf(child),
      required: needed.has(key) && child.default === undefined,
    });
  }
  return rows;
}

function table(rows) {
  const lines = ["| Key | Type | Required | Example | Accepts |", "|---|---|---|---|---|"];
  for (const row of rows) {
    if (row.type === "block" || row.type === "list of") {
      lines.push(
        `| **\`${row.path}\`** | ${row.type === "block" ? "block" : "list"} | ${row.required ? "yes" : ""} | | |`,
      );
      continue;
    }
    lines.push(
      `| \`${row.path}\` | ${row.type} | ${row.required ? "yes" : ""} | \`${row.example}\` | ${row.constraint} |`,
    );
  }
  return lines.join("\n");
}

function jsonSchemaOf(schema) {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

function configKeysPage() {
  const rows = walk(jsonSchemaOf(ConfigSchema));
  return `---
title: config.yaml keys
description: Every setting in office/config.yaml, with an example of each.
---

${BANNER}

Every setting the office reads from \`office/config.yaml\`. Anything not listed
here is refused by name when the office starts, rather than ignored quietly.

${table(rows)}

A key with an example and no "required" can be left out; the example is what the
office uses when you do.
`;
}

function agentsKeysPage() {
  const rows = walk(jsonSchemaOf(AgentsFileSchema));
  return `---
title: agents.yaml keys
description: Every setting in office/agents.yaml, with an example of each.
---

${BANNER}

Who works in your office, and what they are allowed to use. Edited by hand or
from the office; either way it stays yours, and Staffroom keeps your comments
when it writes to it.

${table(rows)}
`;
}

function errorsPage() {
  const rows = RUN_ERROR_CODES.map((code) => {
    const { message, hint } = userMessage(code, {});
    return `### \`${code}\`\n\n${message}\n\n${hint}\n`;
  });

  return `---
title: Errors
description: Every error the office can report, what it means and what to do.
---

${BANNER}

Every error a run can end with. The office shows you the same words; this page
is here so you can search for a code you saw and read it without the office
open.

${rows.join("\n")}`;
}

/**
 * The state the browser draws from.
 *
 * Read off the type rather than a schema, because OfficeState is a TypeScript
 * interface and has no zod to walk. The file is the source either way, so this
 * still cannot drift from the code without CI saying so.
 */
function officeStatePage() {
  const source = readFileSync(
    join(HERE, "..", "..", "..", "packages", "core", "src", "office-state.ts"),
    "utf8",
  );

  return `---
title: OfficeState
description: The snapshot the office sends the browser, field by field.
---

${BANNER}

What the office sends a connected browser, in full. Every field here is
reachable over the WebSocket described in [the protocol](/reference/ws-protocol/),
and nothing else is: there is no second channel and no hidden field.

\`\`\`ts
${source.trim()}
\`\`\`
`;
}

const PAGES = {
  "config-keys.md": configKeysPage(),
  "agents-keys.md": agentsKeysPage(),
  "errors.md": errorsPage(),
  "office-state.md": officeStatePage(),
};

let drifted = 0;
for (const [name, content] of Object.entries(PAGES)) {
  const path = join(OUT, name);
  let existing;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = undefined;
  }

  if (existing === content) continue;

  if (CHECK) {
    console.error(
      existing === undefined
        ? `reference/${name} has not been generated.`
        : `reference/${name} is out of date.`,
    );
    drifted += 1;
    continue;
  }

  writeFileSync(path, content, "utf8");
  console.log(`wrote reference/${name}`);
}

if (CHECK && drifted > 0) {
  console.error("");
  console.error("Run pnpm docs:gen and commit the result.");
  process.exit(1);
}

if (CHECK) console.log("The reference pages match the code.");
