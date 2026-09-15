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
import type { RunStore } from "./events.js";
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
  /** Problems that did not stop the office opening. */
  warnings: ConfigErrorLike[];
  toolFailures: LoadFailure[];
  close(): void;
}

export interface CreateOfficeOptions {
  officeDir: string;
  /** Replaces every provider, for demo mode and tests. */
  adapters?: Map<string, ProviderAdapter>;
  /** Skips loading office/tools, for tests that do not need them. */
  skipCustomTools?: boolean;
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
  const mode: "live" | "demo" = adapters.size === 0 ? "demo" : "live";

  const brainDir = join(officeDir, loaded.config.brain.dir);
  const brain = BrainIndex.open(brainDir, { indexFile: join(officeDir, "brain.index.sqlite") });
  const store = new SqliteRunStore(join(officeDir, "runs.sqlite"));

  const tools = new ToolRegistry({ config: loaded.config });
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
    warnings,
    toolFailures,
    close: () => {
      store.close();
      brain.close();
    },
  };
}
