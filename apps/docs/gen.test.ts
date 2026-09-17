/**
 * The generated reference pages, against the schemas they came from.
 *
 * The acceptance case is coverage: every key in `ConfigSchema` and
 * `AgentsFileSchema` has to appear, with an example. A reference that lists
 * most of the settings is worse than one that lists none — somebody searches
 * for the key they need, does not find it, and concludes it does not exist.
 *
 * The committed output is checked against a fresh run too, because these pages
 * are in git and nothing stops a PR from editing them by hand. `--check` is the
 * same comparison in CI; this is the same thing with a message that says which
 * key went missing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentsFileSchema, ConfigSchema } from "@staffroom/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE = join(HERE, "src", "content", "docs", "reference");

const page = (name: string): string => readFileSync(join(REFERENCE, name), "utf8");

/**
 * Every settable key in a schema, as the page would name it.
 *
 * Deliberately a second implementation rather than an import from the
 * generator: a test that walks the schema with the generator's own walk would
 * agree with it about a key they both miss.
 */
function keysOf(schema: z.ZodType): string[] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const found: string[] = [];

  const visit = (node: Record<string, unknown>, prefix: string): void => {
    const properties = (node["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, child] of Object.entries(properties)) {
      const path = prefix.length === 0 ? key : `${prefix}.${key}`;
      const isObject = child["type"] === "object" && child["properties"] !== undefined;
      const items = child["items"] as Record<string, unknown> | undefined;

      if (isObject) {
        visit(child, path);
        continue;
      }
      if (child["type"] === "array" && items?.["type"] === "object") {
        visit(items, `${path}[]`);
        continue;
      }
      found.push(path);
    }
  };

  visit(json, "");
  return found;
}

describe("every config.yaml key is documented", () => {
  const text = page("config-keys.md");

  it.each(keysOf(ConfigSchema))("documents %s", (key) => {
    expect(text).toContain(`| \`${key}\` |`);
  });

  it("gives every documented key an example", () => {
    // A key listed as "string" with nothing to copy is a row that answered
    // nothing. The example is the reason somebody opened the page.
    const rows = text.split("\n").filter((line) => /^\| `[a-z]/.test(line));
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect(cells[4], row).not.toBe("");
    }
  });
});

describe("every agents.yaml key is documented", () => {
  const text = page("agents-keys.md");

  it.each(keysOf(AgentsFileSchema))("documents %s", (key) => {
    expect(text).toContain(`| \`${key}\` |`);
  });

  it("documents the fields of an agent, not just the list", () => {
    // The most-read part of the whole reference. One row saying "array" tells
    // nobody what to write in it.
    for (const field of ["id", "department", "role", "does", "tools", "model", "instructions"]) {
      expect(text).toContain(`| \`agents[].${field}\` |`);
    }
  });
});

describe("the committed pages match the code", () => {
  it("passes its own --check", () => {
    // The same gate CI runs. It fails here first, with the file named, rather
    // than in a pull request twenty minutes later.
    expect(() =>
      execFileSync("node", [join(HERE, "scripts", "gen.mjs"), "--check"], { cwd: HERE }),
    ).not.toThrow();
  });

  it("says where each page came from, so nobody edits one by hand", () => {
    for (const name of ["config-keys.md", "agents-keys.md", "errors.md", "office-state.md"]) {
      expect(page(name), name).toContain("Written by pnpm docs:gen");
    }
  });
});

describe("the errors page", () => {
  const text = page("errors.md");

  it("has a section per code, with what happened and what to do", () => {
    // Both halves. A code with no hint is a dead end: somebody knows the name
    // of their problem and nothing about fixing it.
    expect(text).toContain("### `NO_MODEL_CONFIGURED`");
    expect(text).toContain("Open Settings > Models");
  });

  it("covers every code the office can raise", async () => {
    const { RUN_ERROR_CODES } = await import("@staffroom/core");
    for (const code of RUN_ERROR_CODES) expect(text, code).toContain(`### \`${code}\``);
  });
});
