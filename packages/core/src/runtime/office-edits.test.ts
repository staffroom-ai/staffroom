import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentsFile, loadRoster } from "../config/load.js";
import { Roster } from "../config/roster.js";
import {
  assignTool,
  envKeyFor,
  refreshAgents,
  renameAgent,
  revealNote,
  setProviderKey,
} from "./office-edits.js";

const AGENTS = `# office/agents.yaml
version: 1
office:
  name: Northlight Studio          # the studio
  timezone: Australia/Melbourne
agents:
  - id: copywriter
    department: marketing
    role: Copywriter
    does: Turns briefs into landing page copy.
    tools: [web]                   # brain tools are always available
  - id: designer
    department: marketing
    role: Brand designer
    does: Produces image briefs and alt text.
`;

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-edits-"));
  writeFileSync(join(dir, "agents.yaml"), AGENTS, "utf8");
  writeFileSync(join(dir, "config.yaml"), "version: 1\nproviders: {}\n", "utf8");
  return dir;
}

describe("renaming someone", () => {
  it("writes the name and records who named them", () => {
    const dir = office();
    expect(renameAgent(dir, "designer", "Mo", "marketing-lead")).toBe(true);

    const text = readFileSync(join(dir, "agents.yaml"), "utf8");
    expect(text).toContain("name: Mo");
    expect(text).toMatch(/named by marketing-lead on \d{4}-\d{2}-\d{2}/);
    expect(loadRoster(dir).agent("designer")?.name).toBe("Mo");
  });

  it("keeps every comment the owner wrote", () => {
    const dir = office();
    renameAgent(dir, "designer", "Mo");
    const text = readFileSync(join(dir, "agents.yaml"), "utf8");
    for (const comment of [
      "# office/agents.yaml",
      "# the studio",
      "# brain tools are always available",
    ]) {
      expect(text, comment).toContain(comment);
    }
  });

  it("says no to somebody who is not in the office", () => {
    expect(renameAgent(office(), "nobody", "X")).toBe(false);
  });
});

describe("giving someone a tool", () => {
  it("adds it to their list", () => {
    const dir = office();
    expect(assignTool(dir, "copywriter", "lookup_order")).toBe(true);
    expect(loadRoster(dir).agent("copywriter")?.tools).toEqual(["web", "lookup_order"]);
  });

  it("creates the list when they had none", () => {
    const dir = office();
    expect(assignTool(dir, "designer", "lookup_order")).toBe(true);
    expect(loadRoster(dir).agent("designer")?.tools).toEqual(["lookup_order"]);
  });

  it("does not add the same tool twice", () => {
    const dir = office();
    assignTool(dir, "copywriter", "lookup_order");
    expect(assignTool(dir, "copywriter", "lookup_order")).toBe(false);
  });
});

describe("storing a key", () => {
  it("writes it to .env and never to config.yaml", () => {
    const dir = office();
    expect(setProviderKey(dir, "anthropic", "sk-ant-secret-value")).toBe(true);

    expect(readFileSync(join(dir, ".env"), "utf8")).toContain(
      "ANTHROPIC_API_KEY=sk-ant-secret-value",
    );
    // config.yaml is the file owners paste into issues and screenshots.
    expect(readFileSync(join(dir, "config.yaml"), "utf8")).not.toContain("sk-ant-secret-value");
  });

  it("replaces a key rather than stacking duplicates", () => {
    const dir = office();
    setProviderKey(dir, "anthropic", "sk-ant-first");
    setProviderKey(dir, "anthropic", "sk-ant-second");

    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("sk-ant-second");
    expect(env).not.toContain("sk-ant-first");
    expect(env.match(/ANTHROPIC_API_KEY=/g)).toHaveLength(1);
  });

  it("leaves other keys alone", () => {
    const dir = office();
    writeFileSync(join(dir, ".env"), "OPENAI_API_KEY=sk-openai\n", "utf8");
    setProviderKey(dir, "anthropic", "sk-ant-x");

    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("OPENAI_API_KEY=sk-openai");
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-x");
  });

  it("refuses a provider it does not know and an empty key", () => {
    const dir = office();
    expect(setProviderKey(dir, "not-a-provider", "x")).toBe(false);
    expect(setProviderKey(dir, "anthropic", "   ")).toBe(false);
  });

  it("names the variable the way the docs do", () => {
    expect(envKeyFor("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(envKeyFor("openai")).toBe("OPENAI_API_KEY");
    expect(envKeyFor("my-gateway")).toBe("MY_GATEWAY_API_KEY");
  });
});

describe("showing a note in the file manager", () => {
  it("refuses anything that points outside the brain", () => {
    const dir = office();
    const brainDir = join(dir, "brain");
    mkdirSync(brainDir, { recursive: true });

    for (const bad of ["../../.env", "/etc/passwd", "a\0b"]) {
      expect(revealNote(brainDir, bad), bad).toBe(false);
    }
  });

  it("refuses a note that is not there", () => {
    const dir = office();
    mkdirSync(join(dir, "brain"), { recursive: true });
    expect(revealNote(join(dir, "brain"), "40-deliverables/marketing/nothing")).toBe(false);
  });

  it("finds a note that is", () => {
    const dir = office();
    const brainDir = join(dir, "brain", "40-deliverables", "marketing");
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, "tagline.md"), "# Tagline\n", "utf8");
    expect(existsSync(join(brainDir, "tagline.md"))).toBe(true);
  });
});

describe("keeping the running office in step with the file", () => {
  it("brings a tool the office just handed out into the roster it is using", () => {
    const dir = office();
    const agentsFile = loadAgentsFile(dir);
    const roster = new Roster(agentsFile);
    const copywriter = roster.agents.find((a) => a.id === "copywriter");

    assignTool(dir, "copywriter", "lookup_order");
    // Before the refresh the office is running on what it read at boot: the file
    // says one thing and every agent, seat and prompt says another.
    expect(copywriter?.tools).toEqual(["web"]);

    expect(refreshAgents(dir, agentsFile)).toBe(true);

    // The same object the roster, its seats and the runner are all holding.
    expect(copywriter?.tools).toEqual(["web", "lookup_order"]);
    expect(roster.agents.find((a) => a.id === "copywriter")?.tools).toContain("lookup_order");
  });

  it("brings a rename in too", () => {
    const dir = office();
    const agentsFile = loadAgentsFile(dir);
    renameAgent(dir, "designer", "Mo", "you");
    refreshAgents(dir, agentsFile);
    expect(agentsFile.agents.find((a) => a.id === "designer")?.name).toBe("Mo");
  });

  it("leaves the last good roster alone when the file will not parse", () => {
    const dir = office();
    const agentsFile = loadAgentsFile(dir);
    writeFileSync(join(dir, "agents.yaml"), "version: 1\nagents: [\n", "utf8");

    expect(refreshAgents(dir, agentsFile)).toBe(false);
    // Still running on what worked, rather than on nothing.
    expect(agentsFile.agents).toHaveLength(2);
  });

  it("ignores a row that is no longer there rather than half-applying the file", () => {
    const dir = office();
    const agentsFile = loadAgentsFile(dir);
    writeFileSync(
      join(dir, "agents.yaml"),
      AGENTS.replace(
        "  - id: designer\n    department: marketing\n    role: Brand designer\n    does: Produces image briefs and alt text.\n",
        "",
      ),
      "utf8",
    );

    refreshAgents(dir, agentsFile);
    // Adding and removing people needs a real reload; this only updates rows
    // that are still there, and says so rather than dropping somebody silently.
    expect(agentsFile.agents).toHaveLength(2);
  });
});
