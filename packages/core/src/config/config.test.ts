import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentsFileSchema, isIanaTimezone } from "./agents.js";
import { ConfigSchema } from "./config.js";
import { expandEnv, parseDotEnv, SECRET_LITERAL_HINT } from "./env.js";
import { ConfigInvalid, didYouMean, printConfigError } from "./errors.js";
import { loadAgentsFile, loadConfig, loadRoster } from "./load.js";
import { Roster, RosterWriter } from "./roster.js";
import { type ToolNameResolver, validateAgents } from "./validate.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const agentsYaml = readFileSync(join(FIXTURES, "agents.yaml"), "utf8");
const configYaml = readFileSync(join(FIXTURES, "config.yaml"), "utf8");

/** An office folder on disk, so the loaders are tested the way they are used. */
function office(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-office-"));
  writeFileSync(join(dir, "agents.yaml"), files["agents.yaml"] ?? agentsYaml, "utf8");
  writeFileSync(join(dir, "config.yaml"), files["config.yaml"] ?? configYaml, "utf8");
  if (files[".env"] !== undefined) writeFileSync(join(dir, ".env"), files[".env"], "utf8");
  return dir;
}

const resolver = (names: string[] = []): ToolNameResolver => new Set(names);

describe("the examples from the spec", () => {
  it("parses agents.yaml with no errors", () => {
    const parsed = AgentsFileSchema.safeParse(loadAgentsFile(office()));
    expect(parsed.success).toBe(true);
  });

  it("parses config.yaml with no errors", () => {
    const dir = office({
      ".env": "ANTHROPIC_API_KEY=sk-ant-x\nOPENAI_API_KEY=sk-o\nBRAVE_API_KEY=b",
    });
    expect(() => loadConfig(dir)).not.toThrow();
  });

  it("validates the shipped roster cleanly once lookup_order is registered", () => {
    const file = loadAgentsFile(office());
    const errors = validateAgents(file, {
      tools: resolver(["lookup_order"]),
      mcp: { servers: {}, deny: [], departments: {} },
      providers: ["anthropic", "openai", "ollama"],
    });
    expect(errors).toEqual([]);
  });
});

describe("agents.yaml schema", () => {
  const base = AgentsFileSchema.parse(loadAgentsFile(office()));

  it("defaults tools to an empty list and lead to false", () => {
    const agent = base.agents.find((a) => a.id === "bookkeeper");
    expect(agent?.tools).toEqual([]);
    expect(agent?.lead).toBe(false);
  });

  it("rejects an unknown key rather than ignoring it", () => {
    const result = AgentsFileSchema.safeParse({ ...base, nickname: "studio" });
    expect(result.success).toBe(false);
  });

  it("rejects a does shorter than ten characters", () => {
    const agents = [{ ...base.agents[0], does: "too short" }];
    expect(AgentsFileSchema.safeParse({ ...base, agents }).success).toBe(false);
  });

  it("rejects an id with capitals or a leading digit", () => {
    for (const id of ["Copywriter", "1copy", "a"]) {
      const agents = [{ ...base.agents[0], id }];
      expect(AgentsFileSchema.safeParse({ ...base, agents }).success, id).toBe(false);
    }
  });

  it("accepts a model id whose model half contains slashes", () => {
    const agents = [{ ...base.agents[0], model: "openrouter/anthropic/claude-sonnet-5" }];
    expect(AgentsFileSchema.safeParse({ ...base, agents }).success).toBe(true);
  });

  it("knows a real timezone from a made-up one", () => {
    expect(isIanaTimezone("Australia/Melbourne")).toBe(true);
    expect(isIanaTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("config.yaml schema", () => {
  it("fills every default from an empty file", () => {
    const c = ConfigSchema.parse({ version: 1 });
    expect(c.server.port).toBe(4242);
    expect(c.runner.max_turns).toBe(25);
    expect(c.runner.max_parallel_tools).toBe(4);
    expect(c.runner.tool_output_max_chars).toBe(20_000);
    expect(c.runner.retries).toEqual({ attempts: 3, base_ms: 1000, max_ms: 20_000 });
    expect(c.brain.pinned_token_budget).toBe(2000);
    expect(c.runner.tool_timeout_ms).toBe(60_000);
    expect(c.approvals.expiry_hours).toBe(24);
    expect(c.brain.dir).toBe("brain");
    expect(c.tools.web.provider).toBe("none");
    expect(c.telemetry.enabled).toBe(false);
  });

  it("requires an embeddings model when embeddings are on", () => {
    expect(
      ConfigSchema.safeParse({ version: 1, brain: { embeddings: { enabled: true } } }).success,
    ).toBe(false);
    expect(
      ConfigSchema.safeParse({
        version: 1,
        brain: { embeddings: { enabled: true, model: "nomic-embed" } },
      }).success,
    ).toBe(true);
  });

  it("names the right file when default_model is put in config.yaml", () => {
    const dir = office({ "config.yaml": "version: 1\ndefault_model: anthropic/claude-sonnet-5\n" });
    try {
      loadConfig(dir);
      expect.unreachable("should have thrown");
    } catch (error) {
      const errors = (error as ConfigInvalid).errors;
      expect(errors[0]?.code).toBe("UNKNOWN_KEY");
      expect(errors[0]?.hint).toBe("put it in office/agents.yaml as a top-level key.");
    }
  });
});

describe("env expansion", () => {
  it("parses .env, ignoring comments and stripping quotes", () => {
    expect(parseDotEnv("# a comment\nA=1\nB=\"two\"\nC='three'\n\nBAD\n")).toEqual({
      A: "1",
      B: "two",
      C: "three",
    });
  });

  it("replaces $NAME and collects the value as a secret", () => {
    const out = expandEnv(
      { providers: { anthropic: { api_key: "$KEY" } } },
      { KEY: "sk-ant-abcdefgh" },
    );
    expect(out.value).toEqual({ providers: { anthropic: { api_key: "sk-ant-abcdefgh" } } });
    expect(out.secrets).toEqual(["sk-ant-abcdefgh"]);
  });

  it("records an unresolved reference instead of substituting nothing", () => {
    const out = expandEnv({ providers: { anthropic: { api_key: "$MISSING" } } }, {});
    expect(out.unresolved).toEqual([{ path: "providers.anthropic.api_key", name: "MISSING" }]);
    expect(out.value).toEqual({ providers: { anthropic: { api_key: "$MISSING" } } });
  });

  it("refuses a literal key in a secret position", () => {
    const out = expandEnv(
      { providers: { anthropic: { api_key: "sk-ant-api03-REALLOOKINGKEY" } } },
      {},
    );
    expect(out.errors[0]?.code).toBe("SECRET_LITERAL_IN_CONFIG");
    expect(out.errors[0]?.hint).toBe(SECRET_LITERAL_HINT);
  });

  it("allows a short placeholder, which is not a key", () => {
    expect(expandEnv({ providers: { x: { api_key: "changeme" } } }, {}).errors).toEqual([]);
  });

  it("leaves non-secret strings alone however long", () => {
    const long = { office: { name: "A studio with a very long name indeed, truly" } };
    expect(expandEnv(long, {}).errors).toEqual([]);
  });

  it("walks arrays and leaves null and numbers intact", () => {
    const out = expandEnv({ a: [1, null, "$K", { b: "$K" }] }, { K: "resolved" });
    expect(out.value).toEqual({ a: [1, null, "resolved", { b: "resolved" }] });
  });

  it("degrades a provider with an unresolved key rather than failing the office", () => {
    const dir = office({ ".env": "OPENAI_API_KEY=sk-o\nBRAVE_API_KEY=b" });
    const loaded = loadConfig(dir);
    expect(loaded.warnings.map((w) => w.code)).toContain("ENV_VAR_UNRESOLVED");
    expect(loaded.config.providers["openai"]?.api_key).toBe("sk-o");
  });
});

describe("validateAgents", () => {
  const base = AgentsFileSchema.parse(loadAgentsFile(office()));
  const agent = (over: Record<string, unknown>) => ({
    id: "agent-a",
    department: "marketing",
    role: "R",
    does: "Does a thing properly.",
    tools: [],
    lead: false,
    ...over,
  });
  const fileWith = (agents: unknown[]) =>
    AgentsFileSchema.parse({ ...base, agents, departments: {} });
  const check = (agents: unknown[], over: Partial<Parameters<typeof validateAgents>[1]> = {}) =>
    validateAgents(fileWith(agents), {
      tools: resolver(),
      mcp: { servers: {}, deny: [], departments: {} },
      providers: ["anthropic"],
      ...over,
    });

  it("reports a duplicate id with the exact sentence", () => {
    const errors = check([agent({ id: "copywriter" }), agent({ id: "copywriter" })]);
    expect(errors[0]?.code).toBe("AGENT_ID_DUPLICATE");
    expect(errors[0]?.message).toBe(
      'Two agents share the id "copywriter" in office/agents.yaml. Ids must be unique.',
    );
  });

  it("refuses a seventh department", () => {
    const agents = ["d0", "d1", "d2", "d3", "d4", "d5", "d6"].map((d, i) =>
      agent({ id: `ag${i}`, department: d }),
    );
    expect(check(agents).map((e) => e.code)).toContain("AGENT_DEPARTMENT_LIMIT");
  });

  it("holds the reception pod to five seats and says why", () => {
    const agents = [
      ...["p0", "p1", "p2", "p3"].map((d, i) => agent({ id: `xa${i}`, department: d })),
      ...Array.from({ length: 6 }, (_, i) => agent({ id: `sa${i}`, department: "support" })),
    ];
    const seat = check(agents).find((e) => e.code === "AGENT_SEAT_LIMIT");
    expect(seat?.message).toBe(
      "Department support has 6 agents but sits in the pod with the reception desk, which holds 5 in v1.",
    );
  });

  it("allows six in a pod that is not the reception one", () => {
    const agents = Array.from({ length: 6 }, (_, i) => agent({ id: `ma${i}` }));
    expect(check(agents).filter((e) => e.code === "AGENT_SEAT_LIMIT")).toEqual([]);
  });

  it("reports two leads in one department", () => {
    const errors = check([agent({ id: "ag1", lead: true }), agent({ id: "ag2", lead: true })]);
    expect(errors.map((e) => e.code)).toContain("AGENT_LEAD_DUPLICATE");
  });

  it("reports a model whose provider is not configured", () => {
    const errors = check([agent({ model: "mistral/large" })]);
    expect(errors[0]?.code).toBe("AGENT_MODEL_PROVIDER_MISSING");
  });

  it("skips the provider check in demo mode, where nothing is configured", () => {
    expect(check([agent({ model: "mistral/large" })], { demoMode: true, providers: [] })).toEqual(
      [],
    );
  });

  it("suggests the closest tool name", () => {
    const errors = check([agent({ tools: ["brain_serch"] })]);
    expect(errors[0]?.code).toBe("AGENT_TOOL_UNKNOWN");
    expect(errors[0]?.message).toBe('no tool called "brain_serch". Did you mean "brain_search"?');
  });

  it("implies the brain tools and the web alias", () => {
    expect(check([agent({ tools: ["brain_search", "brain_read", "brain_write", "web"] })])).toEqual(
      [],
    );
  });

  it("accepts a configured MCP server name as a tool", () => {
    const mcp = {
      servers: { notion: { command: "npx", args: [], env: {} } },
      deny: [],
      departments: {},
    };
    expect(check([agent({ tools: ["notion"] })], { mcp })).toEqual([]);
  });

  it("refuses a denied MCP server", () => {
    const mcp = {
      servers: { stripe: { command: "npx", args: [], env: {} } },
      deny: ["stripe"],
      departments: {},
    };
    expect(check([agent({ tools: ["stripe"] })], { mcp })[0]?.code).toBe("AGENT_TOOL_DENIED");
  });

  it("refuses a server that is not wired to that pod", () => {
    const mcp = {
      servers: { slack: { command: "npx", args: [], env: {} } },
      deny: [],
      departments: { slack: ["ops"] },
    };
    expect(check([agent({ tools: ["slack"] })], { mcp })[0]?.code).toBe(
      "AGENT_TOOL_WRONG_DEPARTMENT",
    );
  });
});

describe("Roster", () => {
  const roster = loadRoster(office());

  it("orders pods by first appearance, not alphabetically", () => {
    expect(roster.departments.map((d) => d.id)).toEqual(["marketing", "finance", "sales"]);
    expect(roster.departments.map((d) => d.pod)).toEqual([0, 1, 2]);
  });

  it("seats agents in file order within a pod", () => {
    expect(roster.seatOf("marketing-lead")).toMatchObject({ pod: 0, seat: 0 });
    expect(roster.seatOf("copywriter")).toMatchObject({ pod: 0, seat: 1 });
  });

  it("uses the declared lead", () => {
    expect(roster.leadFor("marketing")?.id).toBe("marketing-lead");
  });

  it("falls back to the first agent when no lead is declared", () => {
    expect(roster.leadFor("finance")?.id).toBe("bookkeeper");
  });

  it("lists workers excluding the lead", () => {
    expect(roster.workersIn("marketing").map((a) => a.id)).toEqual(["copywriter"]);
  });

  it("labels a department from the file, or title-cases the id", () => {
    expect(roster.department("marketing")?.label).toBe("Marketing");
    const bare = new Roster({ ...roster.file, departments: {} });
    expect(bare.department("marketing")?.label).toBe("Marketing");
  });

  it("exposes the office name, timezone and default model", () => {
    expect(roster.officeName).toBe("Northlight Studio");
    expect(roster.timezone).toBe("Australia/Melbourne");
    expect(roster.defaultModel).toBe("anthropic/claude-sonnet-5");
  });
});

describe("hiring, editing and letting go", () => {
  /*
   * The file is the source of truth, so every one of these has to survive a
   * round trip: written by the writer, read back by the loader. A writer that
   * produced YAML the loader rejects would leave somebody with an office that
   * will not boot and no idea which edit did it.
   */
  const roundTrip = (writer: RosterWriter) =>
    loadRoster(office({ "agents.yaml": writer.toString() }));

  it("adds somebody who is there when the file is read back", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(
      writer.addAgent({
        id: "support-lead",
        department: "marketing",
        role: "Support lead",
        does: "Answers questions from customers about their orders.",
        name: "Wendy",
      }),
    ).toEqual({ ok: true });

    const added = roundTrip(writer).agent("support-lead");
    expect(added?.role).toBe("Support lead");
    expect(added?.name).toBe("Wendy");
  });

  it("keeps every comment in the file while doing it", () => {
    // A hire is the commonest edit there is. If it flattens the file the owner
    // reads, they stop trusting the office with the file.
    const writer = new RosterWriter(agentsYaml);
    writer.addAgent({
      id: "support-lead",
      department: "marketing",
      role: "Support lead",
      does: "Answers questions from customers about their orders.",
    });
    const out = writer.toString();
    expect(out).toContain("# office/agents.yaml");
    expect(out).toContain("# brain tools are always available");
  });

  it("refuses an id that is taken, malformed, or in no department", () => {
    const writer = new RosterWriter(agentsYaml);
    const does = "Answers questions from customers about their orders.";

    expect(writer.addAgent({ id: "bookkeeper", department: "finance", role: "r", does })).toEqual({
      ok: false,
      reason: "There is already somebody with the id bookkeeper.",
    });
    expect(writer.addAgent({ id: "Not An Id", department: "finance", role: "r", does }).ok).toBe(
      false,
    );
    expect(writer.addAgent({ id: "ghost", department: "nowhere", role: "r", does })).toEqual({
      ok: false,
      reason: "There is no department called nowhere.",
    });
  });

  it("removes somebody, and never the last one", () => {
    // An office with no staff will not load, and the owner would be left with a
    // file they have to hand-edit to recover.
    const writer = new RosterWriter(agentsYaml);
    expect(writer.removeAgent("bookkeeper")).toEqual({ ok: true });
    expect(roundTrip(writer).agent("bookkeeper")).toBeUndefined();

    for (const id of writer.agentIds().slice(1)) writer.removeAgent(id);
    expect(writer.removeAgent(writer.agentIds()[0] as string)).toEqual({
      ok: false,
      reason: "An office needs at least one member of staff.",
    });
  });

  it("changes only the fields it was given", () => {
    // An undefined field is one the form did not touch, which is not the same as
    // one the owner cleared. Treating them alike is how editing a role silently
    // empties somebody's tools.
    const writer = new RosterWriter(agentsYaml);
    const before = loadRoster(office({ "agents.yaml": agentsYaml })).agent("copywriter");

    expect(writer.updateAgent("copywriter", { role: "Senior copywriter" })).toEqual({ ok: true });
    const after = roundTrip(writer).agent("copywriter");

    expect(after?.role).toBe("Senior copywriter");
    expect(after?.does).toBe(before?.does);
    expect(after?.tools).toEqual(before?.tools);
  });

  it("puts somebody back on the office default with a null model", () => {
    const writer = new RosterWriter(agentsYaml);
    writer.updateAgent("copywriter", { model: "anthropic/claude-opus-5" });
    expect(roundTrip(writer).agent("copywriter")?.model).toBe("anthropic/claude-opus-5");

    writer.updateAgent("copywriter", { model: null });
    expect(roundTrip(writer).agent("copywriter")?.model).toBeUndefined();
  });

  it("refuses to close a department with people in it, and closes an empty one", () => {
    const writer = new RosterWriter(agentsYaml);
    writer.addAgent({
      id: "helper",
      department: "support",
      role: "Support agent",
      does: "Answers questions from customers about their orders.",
    });

    // Named, and in a sentence that parses for one person as well as several.
    expect(writer.removeDepartment("support")).toEqual({
      ok: false,
      reason: "helper still works in support. Move them first.",
    });

    writer.removeAgent("helper");
    expect(writer.removeDepartment("support")).toEqual({ ok: true });
    expect(roundTrip(writer).department("support")).toBeUndefined();
  });

  it("opens a department, which takes a pod once somebody works in it", () => {
    /*
     * A department is a wedge of the floor, and the floor is drawn from where
     * people sit — so one with nobody in it is in the file and not yet in the
     * room. That is the design, not an oversight: an empty wedge would be a
     * department the owner cannot point at anything in.
     *
     * The fixture already holds six, which is the cap, so this makes room first
     * rather than passing because the add was refused for a different reason.
     */
    const writer = new RosterWriter(agentsYaml);
    expect(writer.removeDepartment("product")).toEqual({ ok: true });
    expect(writer.addDepartment("legal", "Legal")).toEqual({ ok: true });
    expect(roundTrip(writer).department("legal")).toBeUndefined();

    writer.addAgent({
      id: "counsel",
      department: "legal",
      role: "Counsel",
      does: "Reads contracts before anybody signs them.",
    });
    expect(roundTrip(writer).department("legal")?.label).toBe("Legal");
  });

  it("holds the office to six departments, because the floor is a ring of six", () => {
    const writer = new RosterWriter(agentsYaml);
    // Asserted, not assumed: this test is only meaningful if the fixture is full.
    expect(writer.departmentIds()).toHaveLength(6);
    expect(writer.addDepartment("legal", "Legal")).toEqual({
      ok: false,
      reason: "An office holds at most 6 departments.",
    });
  });

  it("renames a department without touching who is in it", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.renameDepartment("finance", "Finance and payroll")).toEqual({ ok: true });
    const roster = roundTrip(writer);
    expect(roster.department("finance")?.label).toBe("Finance and payroll");
    expect(roster.agent("bookkeeper")?.department).toBe("finance");
  });
});

describe("RosterWriter keeps the file the owner's", () => {
  it("sets a name without disturbing a single comment", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.setName("bookkeeper", "Sam", "finance-lead", "2026-09-16")).toBe(true);
    const out = writer.toString();

    for (const comment of [
      "# office/agents.yaml",
      "# written by npx staffroom setup",
      "# optional display names; ids come from the agents",
      "# brain tools are always available",
      "# model: ollama/llama4               # keep this agent local",
    ]) {
      expect(out, comment).toContain(comment);
    }
    expect(out).toContain("named by finance-lead on 2026-09-16");
  });

  it("writes a name that parses back to the same roster plus the name", () => {
    const writer = new RosterWriter(agentsYaml);
    writer.setName("bookkeeper", "Sam", "finance-lead", "2026-09-16");
    const dir = office({ "agents.yaml": writer.toString() });
    expect(loadRoster(dir).agent("bookkeeper")?.name).toBe("Sam");
  });

  it("adds a tool to an existing list and refuses a duplicate", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.addTool("copywriter", "lookup_order")).toBe(true);
    expect(writer.addTool("copywriter", "lookup_order")).toBe(false);
    const dir = office({ "agents.yaml": writer.toString() });
    expect(loadRoster(dir).agent("copywriter")?.tools).toEqual(["web", "lookup_order"]);
  });

  it("creates the list when the agent has none", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.addTool("bookkeeper", "sqlite_query")).toBe(true);
    const dir = office({ "agents.yaml": writer.toString() });
    expect(loadRoster(dir).agent("bookkeeper")?.tools).toEqual(["sqlite_query"]);
  });

  it("changes the default model and keeps every comment", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.setDefaultModel("anthropic/claude-opus-5")).toBe(true);
    const out = writer.toString();

    expect(out).toContain("# office/agents.yaml");
    expect(out).toContain("# model: ollama/llama4               # keep this agent local");
    const dir = office({ "agents.yaml": out });
    expect(loadRoster(dir).defaultModel).toBe("anthropic/claude-opus-5");
  });

  it("leaves each agent's own model alone when the default changes", () => {
    // The default is what everybody uses unless their row says otherwise, so
    // changing it must not quietly overwrite the choices made per person.
    const writer = new RosterWriter(agentsYaml);
    const before = loadRoster(office()).agent("bookkeeper")?.model;
    writer.setDefaultModel("anthropic/claude-opus-5");

    const dir = office({ "agents.yaml": writer.toString() });
    expect(loadRoster(dir).agent("bookkeeper")?.model).toBe(before);
  });

  it("reports no change when it is already that model", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.setDefaultModel("anthropic/claude-sonnet-5")).toBe(false);
  });

  it("reports an unknown agent rather than writing nothing silently", () => {
    const writer = new RosterWriter(agentsYaml);
    expect(writer.setName("nobody", "X", "lead", "2026-09-16")).toBe(false);
    expect(writer.addTool("nobody", "x")).toBe(false);
  });
});

describe("errors", () => {
  it("prints the file, path, code and hint", () => {
    expect(
      printConfigError({
        code: "AGENT_TOOL_UNKNOWN",
        file: "agents.yaml",
        path: "agents[3].tools[1]",
        line: 31,
        message: 'no tool called "lookup_orders". Did you mean "lookup_order"?',
        hint: "check the name in office/tools/ or config.yaml mcp.servers.",
      }),
    ).toBe(
      'office/agents.yaml:31  agents[3].tools[1]\n  AGENT_TOOL_UNKNOWN: no tool called "lookup_orders". Did you mean "lookup_order"?\n  Hint: check the name in office/tools/ or config.yaml mcp.servers.',
    );
  });

  it("omits the line and the hint when there are none", () => {
    expect(
      printConfigError({ code: "YAML_PARSE", file: "config.yaml", path: "(file)", message: "bad" }),
    ).toBe("office/config.yaml  (file)\n  YAML_PARSE: bad");
  });

  it("suggests only a near miss", () => {
    expect(didYouMean("lookup_orders", ["lookup_order", "brain_search"])).toBe("lookup_order");
    expect(didYouMean("totally_different", ["lookup_order"])).toBeUndefined();
  });

  it("reports a missing file rather than crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "staffroom-empty-"));
    expect(() => loadRoster(dir)).toThrow(ConfigInvalid);
  });

  it("reports unreadable YAML with the indentation hint", () => {
    const dir = office({ "agents.yaml": "version: 1\n  bad:\n bad\n" });
    try {
      loadRoster(dir);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ConfigInvalid).errors[0]?.code).toBe("YAML_PARSE");
    }
  });
});
