/**
 * The rules every template folder obeys.
 *
 * These are the things that would each produce a bad first five minutes: an
 * office that will not boot, a roster naming a tool that is not there, a secret
 * shipped in a config, a link that goes nowhere. Every rule here exists because
 * it would be easy to break by hand.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  AgentsFileSchema,
  BrainIndex,
  buildResolver,
  ConfigSchema,
  linksFrom,
  parseNote,
  type ToolNameResolver,
  validateAgents,
} from "@staffroom/core";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  copyTemplate,
  exampleToolsDir,
  listTemplates,
  TEMPLATE_IDS,
  templateDir,
} from "./index.js";

const IMPLIED = ["brain_search", "brain_read", "brain_write", "brain_list", "web", "web_search"];

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

describe.each(listTemplates().map((t) => t.id))("template %s", (id) => {
  const dir = templateDir(id);
  const agentsText = readFileSync(join(dir, "agents.yaml"), "utf8");
  const configText = readFileSync(join(dir, "config.yaml"), "utf8");
  const agents = AgentsFileSchema.parse(parseYaml(agentsText));
  const config = ConfigSchema.parse(parseYaml(configText));

  it("has the files an office needs", () => {
    for (const file of ["agents.yaml", "config.yaml", "approvals.yaml", ".npmrc", "gitignore"]) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    // sheet_append needs somewhere to write on the first run.
    expect(existsSync(join(dir, "data"))).toBe(true);
  });

  it("parses as a valid roster and config", () => {
    expect(agents.agents.length).toBeGreaterThan(0);
    expect(config.version).toBe(1);
  });

  it("pins no model, so the office runs on whatever the owner configures", () => {
    // A shipped model: line sends every new office to one provider's bill.
    expect(agentsText).not.toMatch(/^\s*model:/m);
    for (const agent of agents.agents) expect(agent.model).toBeUndefined();
  });

  it("ships no providers and no MCP servers switched on", () => {
    expect(Object.keys(config.providers)).toEqual([]);
    expect(Object.keys(config.mcp.servers)).toEqual([]);
  });

  it("contains nothing that looks like a key", () => {
    for (const file of walk(dir, (p) => /\.(ya?ml|md|env|json)$/.test(p))) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [
        /\bsk-[A-Za-z0-9_-]{16,}/,
        /\bkey-[A-Za-z0-9_-]{16,}/,
        /\bBearer\s+[A-Za-z0-9._-]{16,}/,
      ]) {
        expect(pattern.test(text), `${relative(dir, file)} looks like it contains a key`).toBe(
          false,
        );
      }
    }
  });

  it("names only tools that exist without --tools", () => {
    // The rule that would otherwise fail boot with AGENT_TOOL_UNKNOWN on a fresh
    // office, which is the worst possible first five minutes.
    const registry: ToolNameResolver = new Set(IMPLIED);
    const errors = validateAgents(agents, {
      tools: registry,
      mcp: config.mcp,
      providers: [],
      demoMode: true,
    });
    expect(errors).toEqual([]);
  });

  it("has a private note, so the owner can see privacy working", () => {
    const privates = walk(join(dir, "brain"), (p) => p.includes("_private"));
    expect(privates.length).toBeGreaterThan(0);
  });

  it("marks every shipped note as a sample", () => {
    for (const file of walk(join(dir, "brain"), (p) => p.endsWith(".md"))) {
      const data = matter(readFileSync(file, "utf8")).data;
      expect(data["sample"], `${relative(dir, file)} is missing sample: true`).toBe(true);
    }
  });

  it("resolves every wiki-link in the sample brain", () => {
    const brainDir = join(dir, "brain");
    const files = walk(brainDir, (p) => p.endsWith(".md") && !p.includes("_private"));
    const notes = files.map((path) =>
      parseNote({
        id: relative(brainDir, path).split("\\").join("/").replace(/\.md$/, ""),
        path,
        text: readFileSync(path, "utf8"),
        birthTime: statSync(path).birthtime,
      }),
    );
    const resolver = buildResolver(notes);

    const broken: string[] = [];
    for (const note of notes) {
      for (const link of linksFrom(note, resolver)) {
        if (!link.resolved) broken.push(`${note.id} -> ${link.to}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("indexes without warnings an owner would have to act on", () => {
    const indexFile = join(mkdtempSync(join(tmpdir(), "staffroom-tpl-")), "brain.index.sqlite");
    const warnings: string[] = [];
    const index = BrainIndex.open(join(dir, "brain"), {
      indexFile,
      onWarning: (w) => warnings.push(`${w.id}: ${w.reason}`),
    });
    expect(warnings).toEqual([]);
    expect(index.count()).toBeGreaterThan(5);
    // Private notes are absent, not filtered.
    expect(index.list({ limit: 100 }).some((n) => n.id.includes("_private"))).toBe(false);
    index.close();
  });

  it("pins a handful of notes, not all of them", () => {
    const indexFile = join(mkdtempSync(join(tmpdir(), "staffroom-tpl-")), "brain.index.sqlite");
    const index = BrainIndex.open(join(dir, "brain"), { indexFile });
    const pinned = index.pinned();
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.length).toBeLessThanOrEqual(6);
    index.close();
  });
});

describe("demo transcripts", () => {
  const dir = join(templateDir("studio"), "demo-runs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

  it("includes a generic one, so nothing typed can fall through", () => {
    expect(files).toContain("generic.jsonl");
  });

  it("parses every transcript", () => {
    for (const file of files) {
      const lines = readFileSync(join(dir, file), "utf8").trim().split("\n");
      expect(lines.length, file).toBeGreaterThan(1);
      for (const line of lines)
        expect(() => JSON.parse(line), `${file}: ${line.slice(0, 40)}`).not.toThrow();
    }
  });

  it("ends every transcript with a done chunk", () => {
    for (const file of files) {
      const lines = readFileSync(join(dir, file), "utf8").trim().split("\n");
      expect(JSON.parse(lines.at(-1) as string), file).toMatchObject({ type: "done" });
    }
  });

  it("calls only tools that exist somewhere", () => {
    const known = new Set([
      ...IMPLIED,
      "assign_task",
      ...readdirSync(exampleToolsDir()).map((f) => f.replace(/\.ts$/, "").replace(/-/g, "_")),
    ]);
    for (const file of files) {
      for (const line of readFileSync(join(dir, file), "utf8").trim().split("\n")) {
        const parsed = JSON.parse(line) as { type?: string; call?: { name: string } };
        if (parsed.type === "tool_call") {
          expect(known.has(parsed.call?.name ?? ""), `${file} calls ${parsed.call?.name}`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe("the example tools", () => {
  const dir = exampleToolsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("ships five", () => {
    expect(files.sort()).toEqual([
      "http-get.ts",
      "lookup-order.ts",
      "send-sms.ts",
      "sheet-append.ts",
      "sqlite-query.ts",
    ]);
  });

  it("each explains itself and says how to try it", () => {
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).toContain("TRY IT:");
      expect(text.startsWith("/**"), `${file} should open with a paragraph saying what it is`).toBe(
        true,
      );
    }
  });

  it("each stays short enough to read in one sitting", () => {
    for (const file of files) {
      const lines = readFileSync(join(dir, file), "utf8").split("\n").length;
      expect(lines, `${file} is ${lines} lines`).toBeLessThan(80);
    }
  });

  it("declares a scope on every one, rather than relying on the default", () => {
    for (const file of files) {
      expect(readFileSync(join(dir, file), "utf8"), file).toMatch(/scope:\s*"(read|write)"/);
    }
  });

  it("gives every write tool a preview, so the card is not generated", () => {
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      if (/scope:\s*"write"/.test(text)) expect(text, file).toContain("preview:");
    }
  });
});

describe("copyTemplate", () => {
  const dest = () => mkdtempSync(join(tmpdir(), "staffroom-copy-"));

  it("produces an office with the files the server needs", () => {
    const target = dest();
    const result = copyTemplate("studio", target);

    for (const file of ["agents.yaml", "config.yaml", "approvals.yaml", ".gitignore"]) {
      expect(existsSync(join(target, file)), file).toBe(true);
    }
    expect(existsSync(join(target, "brain", "00-about", "company.md"))).toBe(true);
    expect(existsSync(join(target, "data"))).toBe(true);
    expect(result.copied).toContain("agents.yaml");
  });

  it("puts the transcripts where the server looks for them", () => {
    const target = dest();
    copyTemplate("studio", target);
    expect(existsSync(join(target, ".staffroom", "demo-runs", "bakery-tagline.jsonl"))).toBe(true);
    expect(existsSync(join(target, ".staffroom", "demo-runs", "generic.jsonl"))).toBe(true);
  });

  it("renames gitignore so the office is git-safe from the start", () => {
    const target = dest();
    copyTemplate("studio", target);
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain(".env");
    expect(existsSync(join(target, "gitignore"))).toBe(false);
  });

  it("leaves the repository's own files behind", () => {
    const target = dest();
    const result = copyTemplate("studio", target);
    expect(existsSync(join(target, "package.json"))).toBe(false);
    expect(existsSync(join(target, "demo-runs"))).toBe(false);
    expect(result.skipped).toContain("demo-runs");
  });

  it("copies the example tools only when asked", () => {
    const without = dest();
    copyTemplate("studio", without);
    expect(existsSync(join(without, "tools"))).toBe(false);

    const with_ = dest();
    const result = copyTemplate("studio", with_, { includeTools: true });
    expect(result.toolsCopied.sort()).toHaveLength(5);
    expect(existsSync(join(with_, "tools", "lookup-order.ts"))).toBe(true);
  });

  it("names the templates that exist when asked for one that does not", () => {
    expect(() => copyTemplate("bakery", dest())).toThrow(/studio/);
  });
});

describe("listTemplates", () => {
  it("puts studio first, because init uses it", () => {
    expect(listTemplates()[0]?.id).toBe("studio");
    expect(TEMPLATE_IDS).toContain("studio");
  });

  it("describes each one in a line", () => {
    for (const template of listTemplates()) {
      expect(template.description.length).toBeGreaterThan(20);
      expect(template.label.length).toBeGreaterThan(0);
    }
  });
});
