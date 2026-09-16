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
import { ToolRegistry } from "../tools/registry.js";
import { FileWhitelist } from "../tools/whitelist.js";
import type { RunStore } from "./events.js";
import { assignTool, renameAgent, revealNote, setProviderKey } from "./office-edits.js";
import { Runner } from "./runner.js";
import { SqliteRunStore } from "./store.js";

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
  assignTool(agentId: string, tool: string): boolean;
  setProviderKey(provider: string, key: string): boolean;
  revealNote(noteId: string): boolean;
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
      } catch {
        // A name that collides with something already registered. The connector
        // strip reports the server; one tool is not worth refusing the rest.
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
    renameAgent: (agentId: string, name: string) => renameAgent(officeDir, agentId, name),
    assignTool: (agentId: string, tool: string) => assignTool(officeDir, agentId, tool),
    setProviderKey: (provider: string, key: string) => setProviderKey(officeDir, provider, key),
    revealNote: (noteId: string) => revealNote(brainDir, noteId),
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
