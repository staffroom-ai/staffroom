/**
 * createOffice: everything assembled, ready to take a task.
 *
 * One function so the server, the CLI and the tests all build the office the same
 * way. Anything that can degrade does: a provider without a key is skipped, a
 * custom tool that will not compile is reported, and the office still opens.
 */
import { join } from "node:path";
import { BrainIndex } from "../brain/index.js";
import type { AgentsFile } from "../config/agents.js";
import type { OfficeConfig } from "../config/config.js";
import { loadAgentsFile, loadConfig } from "../config/load.js";
import { Roster } from "../config/roster.js";
import { type ConfigErrorLike, validateAgents } from "../config/validate-types.js";
import { McpManager } from "../mcp/manager.js";
import { loadAllTokens } from "../mcp/oauth.js";
import { AnthropicAdapter } from "../providers/anthropic.js";
import { OllamaAdapter } from "../providers/ollama.js";
import { OpenAIAdapter } from "../providers/openai.js";
import { isLocalProvider } from "../providers/resolve.js";
import type { ProviderAdapter } from "../providers/types.js";
import { configureRedaction } from "../redact.js";
import { brainTools } from "../tools/builtins/brain.js";
import { webSearchTool } from "../tools/builtins/web-search.js";
import { type LoadFailure, loadCustomTools } from "../tools/loader.js";
import { ToolNameConflict, ToolRegistry } from "../tools/registry.js";
import { FileWhitelist } from "../tools/whitelist.js";
import type { RunStore } from "./events.js";
import {
  addAgent,
  addDepartment,
  assignTool,
  type EditResult,
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
import { Runner } from "./runner.js";
import { seedSampleRun } from "./seed.js";
import { SqliteRunStore } from "./store.js";

export interface NewAgent {
  id: string;
  department: string;
  role: string;
  does: string;
  name?: string;
  model?: string;
  /** Opens the department as part of the hire, when it is not there yet. */
  departmentLabel?: string;
}

export interface AgentEdit {
  role?: string;
  does?: string;
  department?: string;
  /** null puts them back on the office default. */
  model?: string | null;
  /** The whole list: this is how a connector is taken away as well as given. */
  tools?: string[];
}

export interface Office {
  runner: Runner;
  roster: Roster;
  config: OfficeConfig;
  agentsFile: AgentsFile;
  tools: ToolRegistry;
  brain: BrainIndex;
  store: RunStore;
  providers: Map<string, ProviderAdapter>;
  mode: "live" | "demo";
  /** Connections to MCP servers, and their health. */
  mcp: McpManager;
  /** Permissions the owner has already given. */
  whitelist: FileWhitelist;
  /** Problems that did not stop the office opening. */
  warnings: ConfigErrorLike[];
  toolFailures: LoadFailure[];
  /** Edits to the owner's own files, made through the document API. */
  renameAgent(agentId: string, name: string): boolean;
  /** Hires, leavers and edits, all through the document-mode writer. */
  addAgent(agent: NewAgent): EditResult;
  removeAgent(agentId: string): EditResult;
  updateAgent(agentId: string, fields: AgentEdit): EditResult;
  setOfficeName(name: string): EditResult;
  /** Connectors, in config.yaml. The office re-reads the file after each. */
  setMcpServer(name: string, server: Record<string, unknown>): Promise<EditResult>;
  /** A secret in office/.env, referred to from config.yaml as `$NAME`. */
  setEnvValue(name: string, value: string): EditResult;
  removeMcpServer(name: string): Promise<EditResult>;
  setMcpDepartments(name: string, departments: string[]): Promise<EditResult>;
  addDepartment(id: string, label: string): EditResult;
  renameDepartment(id: string, label: string): EditResult;
  removeDepartment(id: string): EditResult;
  /** Re-reads agents.yaml into the running office, hires and leavers included. */
  reloadRoster(): boolean;
  /** Re-reads config.yaml's mcp section: servers added, removed, denied. */
  reloadMcp(): Promise<boolean>;
  assignTool(agentId: string, tool: string): boolean;
  setDefaultModel(model: string): boolean;
  setProviderKey(provider: string, key: string): boolean;
  revealNote(noteId: string, app?: string): boolean;
  close(): void;
}

/**
 * The part of an input a permission should be pinned to.
 *
 * "Approve and always allow" on an email means "to this person". Recording the
 * whole input would make the permission useless — the next email has a different
 * body — and recording nothing would make it far too wide.
 */
const DESTINATION_FIELDS = ["to", "recipient", "email", "address", "channel", "url", "phone"];

function destinationMatch(input: unknown): Record<string, string> | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const match: Record<string, string> = {};

  for (const field of DESTINATION_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) match[field] = value;
  }
  return Object.keys(match).length === 0 ? undefined : match;
}

export interface CreateOfficeOptions {
  officeDir: string;
  /** Replaces every provider, for demo mode and tests. */
  adapters?: Map<string, ProviderAdapter>;
  /** Skips loading office/tools, for tests that do not need them. */
  skipCustomTools?: boolean;
  /** Skips connecting to MCP servers, for tests that do not need them. */
  skipMcp?: boolean;
  /** Loopback URL an OAuth provider sends the owner's browser back to. */
  oauthRedirectUrl?: string;
  /**
   * Says outright whether this is a demo. Inferring it from the adapter count is
   * wrong the moment demo mode injects one: a replaying office would report
   * itself as live and the owner would believe recorded work was real.
   */
  mode?: "live" | "demo";
  /**
   * Told whenever a connector's health or tool list changes.
   *
   * The manager has always reported this and nobody was listening, so the
   * connector strip showed whatever was true at boot — which is "starting" for
   * every server, because none of them have answered yet a millisecond in. A
   * server that came up fifteen seconds later stayed grey on screen for the rest
   * of the session.
   */
  onMcpChange?: () => void;
}

/** Builds an adapter per configured provider, skipping any that cannot work. */
export function buildAdapters(config: OfficeConfig): {
  adapters: Map<string, ProviderAdapter>;
  skipped: string[];
} {
  const adapters = new Map<string, ProviderAdapter>();
  const skipped: string[] = [];

  for (const [id, provider] of Object.entries(config.providers)) {
    const kind = provider.kind ?? id;
    const local = isLocalProvider(provider, id);
    const key = provider.api_key;

    if (!local && (key === undefined || key.length === 0 || key.startsWith("$"))) {
      // An unresolved $NAME or a missing key means this provider is not usable.
      skipped.push(id);
      continue;
    }

    if (kind === "anthropic") {
      adapters.set(
        id,
        new AnthropicAdapter({
          apiKey: key ?? "",
          id,
          ...(provider.base_url === undefined ? {} : { baseURL: provider.base_url }),
          pricingOverrides: toPricing(provider.pricing),
        }),
      );
    } else if (kind === "ollama") {
      adapters.set(
        id,
        new OllamaAdapter({
          id,
          ...(provider.base_url === undefined ? {} : { baseUrl: provider.base_url }),
        }),
      );
    } else {
      adapters.set(
        id,
        new OpenAIAdapter({
          apiKey: key ?? "",
          id,
          ...(provider.base_url === undefined ? {} : { baseURL: provider.base_url }),
          ...(provider.label === undefined ? {} : { label: provider.label }),
          ...(provider.stream_usage === undefined ? {} : { streamUsage: provider.stream_usage }),
          ...(provider.max_context_tokens === undefined
            ? {}
            : { maxContextTokens: provider.max_context_tokens }),
          pricingOverrides: toPricing(provider.pricing),
        }),
      );
    }
  }
  return { adapters, skipped };
}

function toPricing(pricing: OfficeConfig["providers"][string]["pricing"]) {
  return Object.fromEntries(
    Object.entries(pricing).map(([model, p]) => [
      model,
      {
        inputPer1k: p.input_per_1k,
        outputPer1k: p.output_per_1k,
        ...(p.cached_input_per_1k === undefined ? {} : { cachedInputPer1k: p.cached_input_per_1k }),
      },
    ]),
  );
}

export async function createOffice(options: CreateOfficeOptions): Promise<Office> {
  const { officeDir } = options;

  const loaded = loadConfig(officeDir);
  const agentsFile = loadAgentsFile(officeDir);
  const roster = new Roster(agentsFile);

  // Everything the office knows to be a secret, before a single event is written.
  configureRedaction(loaded.secrets);

  const { adapters, skipped } =
    options.adapters === undefined
      ? buildAdapters(loaded.config)
      : { adapters: options.adapters, skipped: [] };
  const mode: "live" | "demo" = options.mode ?? (adapters.size === 0 ? "demo" : "live");

  const brainDir = join(officeDir, loaded.config.brain.dir);
  const brain = BrainIndex.open(brainDir, { indexFile: join(officeDir, "brain.index.sqlite") });
  const store = new SqliteRunStore(join(officeDir, "runs.sqlite"));
  // A template may ship one run that already happened, so a brand new office is
  // not an empty room. Only ever into an empty log; see seed.ts.
  await seedSampleRun(officeDir, store);

  // The registry blocks on approvals; the store is what makes them visible. Without
  // this wiring an approval would pause a run that the office could never show.
  const recordApproval = (
    request: Parameters<
      NonNullable<ConstructorParameters<typeof ToolRegistry>[0]["onApprovalNeeded"]>
    >[0],
  ): void => {
    void store.append(request.runId, {
      type: "approval_needed",
      approvalId: request.approvalId,
      toolCallId: request.toolCallId,
      tool: { name: request.tool.name, source: request.tool.source, scope: "write" },
      input: request.input,
      preview: request.preview,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
    });
  };

  // Permissions the owner gave earlier, read from their own approvals.yaml.
  const whitelist = new FileWhitelist(officeDir, {
    whitelistDays: loaded.config.approvals.whitelist_days,
  });

  const tools = new ToolRegistry({
    config: loaded.config,
    whitelist,
    onGrant: ({ agentId, tool, input, fingerprint, match, allowAnyRecipient }) => {
      // The owner's own choice wins. Without one, only the fields the preview
      // treats as a destination become the match, so "always allow" means "to
      // this recipient" rather than "with any input at all".
      const chosen = match ?? destinationMatch(input);
      whitelist.grant({
        agentId,
        tool,
        fingerprint,
        ...(chosen === undefined
          ? { allowAnyRecipient: allowAnyRecipient === true }
          : { match: chosen }),
      });
    },
    onApprovalNeeded: recordApproval,
    // A local write never blocks, but the pair is still recorded so the audit
    // trail reads the same whether the owner was asked or not.
    onLocalWrite: (request) => {
      recordApproval(request);
      void store.append(request.runId, {
        type: "approval_resolved",
        approvalId: request.approvalId,
        decision: "approve",
        by: "system",
      });
    },
    onApprovalResolved: ({ approvalId, runId, decision, by, note }) => {
      void store.append(runId, {
        type: "approval_resolved",
        approvalId,
        decision,
        by,
        ...(note === undefined ? {} : { note }),
      });
    },
  });
  for (const t of brainTools({
    brainDir,
    departmentFor: (id) => roster.agent(id)?.department ?? "",
  })) {
    tools.register(t);
  }
  tools.register(webSearchTool(loaded.config));

  const toolFailures: LoadFailure[] = [];
  if (options.skipCustomTools !== true) {
    const custom = await loadCustomTools({ dir: join(officeDir, loaded.config.tools.custom_dir) });
    for (const { tool } of custom.tools) {
      try {
        tools.register(tool);
      } catch (error) {
        toolFailures.push({
          file: tool.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    toolFailures.push(...custom.failures);
  }

  // MCP servers are started without being waited for. One on the other side of a
  // slow network, or one that never answers, must not hold the office closed:
  // it shows as unavailable on the connector strip and the staff carry on.
  const mcp = new McpManager({
    config: loaded.config.mcp,
    officeDir,
    ...(options.onMcpChange === undefined
      ? {}
      : { onStatus: options.onMcpChange, onToolsChanged: options.onMcpChange }),
    // Filled in by the server once it knows its own port; without it a remote
    // server simply cannot be signed in to, which beginOAuth says plainly.
    ...(options.oauthRedirectUrl === undefined
      ? {}
      : { oauthRedirectUrl: options.oauthRedirectUrl }),
  });
  mcp.wire(
    (tool) => {
      try {
        tools.register(tool);
      } catch (error) {
        /*
         * A name that collides with something already registered is expected and
         * survivable: the connector strip reports the server, and one tool is not
         * worth refusing the rest.
         *
         * Anything else is not expected, and this used to swallow all of it. It
         * hid the bug that made every MCP tool fail to register in every office
         * — connected server, ready connector, no tools — with nothing said
         * anywhere. A failure the owner cannot see is a failure nobody fixes.
         */
        if (error instanceof ToolNameConflict) return;
        toolFailures.push({
          file: tool.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    (name) => tools.unregister(name),
  );
  // Any token saved by a previous session is registered for redaction before a
  // single run can start, so one cannot reach a log on the way to being used.
  loadAllTokens(officeDir, Object.keys(loaded.config.mcp.servers));
  if (options.skipMcp !== true) mcp.start();

  // Checked after the tools exist, so a roster naming a custom tool validates.
  const warnings: ConfigErrorLike[] = [
    ...loaded.warnings,
    ...validateAgents(agentsFile, {
      tools,
      mcp: loaded.config.mcp,
      providers: [...adapters.keys()],
      demoMode: mode === "demo",
    }),
    ...skipped.map((id) => ({
      code: "ENV_VAR_UNRESOLVED" as const,
      file: "config.yaml" as const,
      path: `providers.${id}`,
      message: `${id} has no usable API key, so it is not available.`,
      hint: `add its key to office/.env, or remove the ${id} block from office/config.yaml.`,
    })),
  ];

  const runner = new Runner({
    store,
    tools,
    brain,
    roster,
    agentsFile,
    config: loaded.config,
    providers: adapters,
    brainDir,
    officeDir,
    mode,
  });

  /*
   * Written, then read straight back into the running office.
   *
   * The same rule as the roster: writing config.yaml on its own left the office
   * with the connectors it booted with, which is the bug this pairs with.
   */
  const applyMcpEdit = async (result: EditResult): Promise<EditResult> => {
    if (!result.ok) return result;
    let fresh: OfficeConfig;
    try {
      fresh = loadConfig(officeDir).config;
    } catch {
      return { ok: false, reason: "config.yaml no longer reads cleanly." };
    }
    loaded.config.mcp = fresh.mcp;
    await mcp.applyConfig(fresh.mcp);
    return { ok: true };
  };

  const applyRosterEdit = (result: EditResult): EditResult => {
    if (result.ok) refreshAgents(officeDir, agentsFile, roster);
    return result;
  };

  return {
    runner,
    roster,
    config: loaded.config,
    agentsFile,
    tools,
    brain,
    store,
    providers: adapters,
    mode,
    // Both edits re-read the file into the objects already in use, so the change
    // is live in this office rather than only on disk until the next restart.
    renameAgent: (agentId: string, name: string) => {
      if (!renameAgent(officeDir, agentId, name)) return false;
      refreshAgents(officeDir, agentsFile);
      return true;
    },
    assignTool: (agentId: string, tool: string) => {
      if (!assignTool(officeDir, agentId, tool)) return false;
      refreshAgents(officeDir, agentsFile);
      return true;
    },
    setDefaultModel: (model: string) => {
      if (!setDefaultModel(officeDir, model)) return false;
      refreshAgents(officeDir, agentsFile);
      return true;
    },
    /*
     * Every roster edit is written and then read straight back in.
     *
     * Writing the file alone is what made the first version of this useless:
     * agents.yaml gained a person and the office carried on with the staff it
     * booted with. Reading it back through the roster is what makes an edit from
     * Settings show up in the room.
     */
    addAgent: (agent: NewAgent) => applyRosterEdit(addAgent(officeDir, agent)),
    removeAgent: (agentId: string) => applyRosterEdit(removeAgent(officeDir, agentId)),
    updateAgent: (agentId: string, fields: AgentEdit) =>
      applyRosterEdit(updateAgent(officeDir, agentId, fields)),
    setOfficeName: (name: string) => applyRosterEdit(setOfficeName(officeDir, name)),
    setEnvValue: (name: string, value: string) => setEnvValue(officeDir, name, value),
    setMcpServer: async (name: string, server: Record<string, unknown>) =>
      applyMcpEdit(setMcpServer(officeDir, name, server)),
    removeMcpServer: async (name: string) => applyMcpEdit(removeMcpServer(officeDir, name)),
    setMcpDepartments: async (name: string, departments: string[]) =>
      applyMcpEdit(setMcpDepartments(officeDir, name, departments)),
    addDepartment: (id: string, label: string) =>
      applyRosterEdit(addDepartment(officeDir, id, label)),
    renameDepartment: (id: string, label: string) =>
      applyRosterEdit(renameDepartment(officeDir, id, label)),
    removeDepartment: (id: string) => applyRosterEdit(removeDepartment(officeDir, id)),
    reloadRoster: () => refreshAgents(officeDir, agentsFile, roster),
    /*
     * Adding a server to config.yaml takes effect here.
     *
     * The manager has always had applyConfig and nothing ever called it, so a
     * connector added to the file did not exist until the office was restarted
     * — and nothing said so. The office reads the file again rather than being
     * handed a config, so this is the same path whether the edit came from an
     * editor or from Settings.
     */
    reloadMcp: async () => {
      let fresh: OfficeConfig;
      try {
        fresh = loadConfig(officeDir).config;
      } catch {
        // Half-edited on disk. The office keeps the servers it has.
        return false;
      }
      loaded.config.mcp = fresh.mcp;
      await mcp.applyConfig(fresh.mcp);
      return true;
    },
    setProviderKey: (provider: string, key: string) => setProviderKey(officeDir, provider, key),
    revealNote: (noteId: string, app?: string) => revealNote(brainDir, noteId, app),
    warnings,
    toolFailures,
    mcp,
    whitelist,
    close: () => {
      void mcp.stop();
      store.close();
      brain.close();
    },
  };
}
