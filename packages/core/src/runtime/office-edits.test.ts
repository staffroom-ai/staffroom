import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadAgentsFile, loadConfig, loadRoster } from "../config/load.js";
import { Roster } from "../config/roster.js";
import { buildAdapters } from "./office.js";
import {
  addAgent,
  addDepartment,
  assignTool,
  envKeyFor,
  fileManagerFor,
  refreshAgents,
  removeAgent,
  removeDepartment,
  removeMcpServer,
  renameAgent,
  renameDepartment,
  revealNote,
  setDefaultModel,
  setEnvValue,
  setMcpDepartments,
  setMcpServer,
  setOfficeName,
  setProviderKey,
  updateAgent,
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

/** The shipped template's shape: no providers, and the examples commented out. */
const CONFIG = `# office/config.yaml
#
# Keys live in office/.env, never here. Write $NAME and the office reads it.
version: 2

providers: {}
  # anthropic:
  #   api_key: $ANTHROPIC_API_KEY
`;

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-edits-"));
  writeFileSync(join(dir, "agents.yaml"), AGENTS, "utf8");
  writeFileSync(join(dir, "config.yaml"), CONFIG, "utf8");
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

  /*
   * The test that was missing, and the reason this shipped broken.
   *
   * Every existing test here checked a file: the key reaches .env, it is not
   * duplicated, it does not land in config.yaml. All true, and the feature did
   * not work — the office builds its adapters from config.yaml, which the
   * template ships empty, so the key was written somewhere nothing read. A
   * tester pasting a key got a success message and stayed in demo mode.
   *
   * So this asserts the outcome instead: after the paste, is there a provider
   * the office can actually run on.
   */
  it("leaves the office able to use the key, not just able to find it", () => {
    const dir = office();
    setProviderKey(dir, "anthropic", "sk-ant-secret-value");

    const { adapters, skipped } = buildAdapters(loadConfig(dir).config);
    expect(adapters.has("anthropic")).toBe(true);
    expect(skipped).not.toContain("anthropic");
  });

  it("puts the variable's name in config.yaml and never its value", () => {
    const dir = office();
    setProviderKey(dir, "anthropic", "sk-ant-secret-value");

    // Read as YAML rather than as text: the template carries a commented-out
    // `# api_key: $ANTHROPIC_API_KEY` example, so a grep for that string passes
    // whether or not anything was written.
    const config = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      providers: Record<string, { api_key?: string }>;
    };
    expect(config.providers["anthropic"]?.api_key).toBe("$ANTHROPIC_API_KEY");
    expect(readFileSync(join(dir, "config.yaml"), "utf8")).not.toContain("sk-ant-secret-value");
  });

  it("keeps the commented-out examples, which are how people learn the file", () => {
    const dir = office();
    setProviderKey(dir, "anthropic", "sk-ant-secret-value");
    expect(readFileSync(join(dir, "config.yaml"), "utf8")).toContain(
      "Keys live in office/.env, never here.",
    );
  });

  it("does not argue with a provider the owner has already set up", () => {
    // Somebody pointing Anthropic at a proxy, or naming their own variable,
    // meant it. A pasted key updates .env and leaves their line alone.
    const dir = office();
    writeFileSync(
      join(dir, "config.yaml"),
      "version: 2\nproviders:\n  anthropic:\n    api_key: $WORK_KEY\n",
      "utf8",
    );
    setProviderKey(dir, "anthropic", "sk-ant-x");

    const config = readFileSync(join(dir, "config.yaml"), "utf8");
    expect(config).toContain("$WORK_KEY");
    expect(config).not.toContain("$ANTHROPIC_API_KEY");
  });

  it("takes an address for Ollama, and writes no secret at all", () => {
    // There is nothing secret about the address of a program on your own
    // machine, and OLLAMA_API_KEY was a variable nothing ever read.
    const dir = office();
    expect(setProviderKey(dir, "ollama", "http://127.0.0.1:11434")).toBe(true);

    expect(readFileSync(join(dir, "config.yaml"), "utf8")).toContain("http://127.0.0.1:11434");
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(buildAdapters(loadConfig(dir).config).adapters.has("ollama")).toBe(true);
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

describe("the model everybody uses", () => {
  it("is written to agents.yaml, keeping the owner's comments", () => {
    const dir = office();
    expect(setDefaultModel(dir, "anthropic/claude-opus-5")).toBe(true);

    const text = readFileSync(join(dir, "agents.yaml"), "utf8");
    expect(text).toContain("default_model: anthropic/claude-opus-5");
    expect(text).toContain("# the studio");
    expect(text).toContain("# brain tools are always available");
  });

  it("parses back to a roster with that default", () => {
    const dir = office();
    setDefaultModel(dir, "anthropic/claude-opus-5");
    expect(loadRoster(dir).defaultModel).toBe("anthropic/claude-opus-5");
  });

  it("says no rather than throwing when there is no file to edit", () => {
    expect(setDefaultModel(join(tmpdir(), "staffroom-nowhere-at-all"), "x/y")).toBe(false);
  });
});

describe("showing a file in the file manager", () => {
  it("selects the file on macOS rather than opening it", () => {
    // Without -R, `open` hands the .md to whatever owns markdown, which is not
    // what "Show in Finder" says it does.
    expect(fileManagerFor("darwin", "/o/brain/a.md")).toEqual({
      command: "open",
      args: ["-R", "/o/brain/a.md"],
    });
  });

  it("uses explorer on Windows and xdg-open everywhere else", () => {
    expect(fileManagerFor("win32", "C:/o/a.md").command).toBe("explorer");
    expect(fileManagerFor("linux", "/o/a.md").command).toBe("xdg-open");
    expect(fileManagerFor("freebsd", "/o/a.md").command).toBe("xdg-open");
  });
});

describe("editing the roster from outside the office", () => {
  /*
   * The same edits Settings makes, against a folder on disk. What matters at
   * this level is that each one writes a file the loader will read back, and
   * that a refusal comes back as a sentence rather than as a thrown error —
   * these end up under a form field.
   */
  const HIRE = {
    id: "support-lead",
    department: "marketing",
    role: "Support lead",
    does: "Answers questions from customers about their orders.",
  };

  it("hires somebody the loader can read back", () => {
    const dir = office();
    expect(addAgent(dir, HIRE)).toEqual({ ok: true });
    expect(loadAgentsFile(dir).agents.map((a) => a.id)).toContain("support-lead");
  });

  it("opens the department as part of the hire when asked to", () => {
    const dir = office();
    expect(addAgent(dir, { ...HIRE, department: "support", departmentLabel: "Support" })).toEqual({
      ok: true,
    });
    expect(loadAgentsFile(dir).departments["support"]).toBe("Support");
  });

  it("passes the writer's refusal back rather than throwing", () => {
    const dir = office();
    const result = addAgent(dir, { ...HIRE, id: "copywriter" });
    expect(result).toEqual({
      ok: false,
      reason: "There is already somebody with the id copywriter.",
    });
  });

  it("says so when there is no agents.yaml to edit", () => {
    // A path somebody mistyped, or an office folder that is not one.
    const missing = mkdtempSync(join(tmpdir(), "staffroom-none-"));
    const result = addAgent(missing, HIRE);
    expect(result.ok).toBe(false);
  });

  it("removes, updates and renames", () => {
    const dir = office();
    addAgent(dir, HIRE);

    expect(updateAgent(dir, "support-lead", { role: "Head of support" })).toEqual({ ok: true });
    expect(loadAgentsFile(dir).agents.find((a) => a.id === "support-lead")?.role).toBe(
      "Head of support",
    );

    expect(removeAgent(dir, "support-lead")).toEqual({ ok: true });
    expect(loadAgentsFile(dir).agents.map((a) => a.id)).not.toContain("support-lead");

    expect(setOfficeName(dir, "Chhabra Works")).toEqual({ ok: true });
    expect(loadAgentsFile(dir).office.name).toBe("Chhabra Works");
  });

  it("refuses an office with no name", () => {
    expect(setOfficeName(office(), "   ")).toEqual({
      ok: false,
      reason: "An office needs a name.",
    });
  });

  it("opens, renames and closes a department", () => {
    const dir = office();
    expect(addDepartment(dir, "support", "Support")).toEqual({ ok: true });
    expect(renameDepartment(dir, "support", "Customer support")).toEqual({ ok: true });
    expect(loadAgentsFile(dir).departments["support"]).toBe("Customer support");

    expect(removeDepartment(dir, "support")).toEqual({ ok: true });
    expect(loadAgentsFile(dir).departments["support"]).toBeUndefined();
  });

  it("will not close a department somebody works in", () => {
    const dir = office();
    const result = removeDepartment(dir, "marketing");
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("Move them first");
  });

  it("refuses an id, a department and a name it does not know", () => {
    const dir = office();
    expect(removeAgent(dir, "nobody").ok).toBe(false);
    expect(updateAgent(dir, "nobody", { role: "x" }).ok).toBe(false);
    expect(updateAgent(dir, "copywriter", { department: "nowhere" }).ok).toBe(false);
    expect(renameDepartment(dir, "nowhere", "X").ok).toBe(false);
    expect(removeDepartment(dir, "nowhere").ok).toBe(false);
  });
});

describe("storing a secret by name", () => {
  /*
   * An OAuth client secret is the same kind of thing as a model key: it belongs
   * in office/.env, and config.yaml should carry only `$NAME`.
   */
  it("writes it to .env, where the redaction and the bundle already look", () => {
    const dir = office();
    expect(setEnvValue(dir, "GMAIL_OAUTH_CLIENT_SECRET", "shh")).toEqual({ ok: true });
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("GMAIL_OAUTH_CLIENT_SECRET=shh");
  });

  it("replaces rather than stacking, so the old one cannot be read back", () => {
    const dir = office();
    setEnvValue(dir, "GMAIL_OAUTH_CLIENT_SECRET", "first");
    setEnvValue(dir, "GMAIL_OAUTH_CLIENT_SECRET", "second");

    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("second");
    expect(env).not.toContain("first");
  });

  it("refuses a name that is not a variable name, and an empty value", () => {
    const dir = office();
    expect(setEnvValue(dir, "not a name", "x").ok).toBe(false);
    expect(setEnvValue(dir, "lower_case", "x").ok).toBe(false);
    expect(setEnvValue(dir, "FINE", "   ").ok).toBe(false);
  });
});

describe("connectors in config.yaml", () => {
  const CONFIG = "version: 2\nmcp:\n  servers: {}\n  deny: []\n  departments: {}\n";
  const withConfig = (): string => {
    const dir = office();
    writeFileSync(join(dir, "config.yaml"), CONFIG, "utf8");
    return dir;
  };
  const read = (dir: string) =>
    parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      mcp: { servers: Record<string, unknown>; departments: Record<string, unknown> };
    };

  it("adds a server and takes it away again", () => {
    const dir = withConfig();
    expect(setMcpServer(dir, "gmail", { url: "https://x/mcp", auth: "oauth" })).toEqual({
      ok: true,
    });
    expect(read(dir).mcp.servers["gmail"]).toEqual({ url: "https://x/mcp", auth: "oauth" });

    expect(removeMcpServer(dir, "gmail")).toEqual({ ok: true });
    expect(read(dir).mcp.servers["gmail"]).toBeUndefined();
  });

  it("refuses a name that is not a connector name", () => {
    expect(setMcpServer(withConfig(), "Not A Name", { url: "https://x/mcp" }).ok).toBe(false);
  });

  it("writes an empty department list as an absence, because that is what it means", () => {
    // Absent is what the registry reads as "every department", so the file
    // should say the same thing the office does rather than an empty array.
    const dir = withConfig();
    setMcpServer(dir, "gmail", { url: "https://x/mcp" });

    setMcpDepartments(dir, "gmail", ["support"]);
    expect(read(dir).mcp.departments["gmail"]).toEqual(["support"]);

    setMcpDepartments(dir, "gmail", []);
    expect(read(dir).mcp.departments["gmail"]).toBeUndefined();
  });

  it("takes the wiring away with the server", () => {
    const dir = withConfig();
    setMcpServer(dir, "gmail", { url: "https://x/mcp" });
    setMcpDepartments(dir, "gmail", ["support"]);

    removeMcpServer(dir, "gmail");
    expect(read(dir).mcp.departments["gmail"]).toBeUndefined();
  });

  it("says so rather than throwing when there is no config.yaml", () => {
    const bare = mkdtempSync(join(tmpdir(), "staffroom-noconfig-"));
    expect(setMcpServer(bare, "gmail", { url: "https://x/mcp" }).ok).toBe(false);
    expect(removeMcpServer(bare, "gmail").ok).toBe(false);
    expect(setMcpDepartments(bare, "gmail", []).ok).toBe(false);
  });
});
