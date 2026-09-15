/**
 * Which model does this agent run on?
 *
 * Four steps, in order: a task-bar override, the agent's own `model:`, the office
 * `default_model`, then the first configured provider's default. `source` records
 * which step answered, because the office shows it and an owner debugging "why is
 * this agent on the wrong model" needs to know.
 */
import type { AgentConfig, AgentsFile } from "../config/agents.js";
import type { OfficeConfig, ProviderConfig } from "../config/config.js";
import { RunError } from "../runtime/errors.js";

export interface ModelId {
  provider: string;
  model: string;
}

export type ModelSource = "override" | "agent" | "office_default" | "first_provider";

export interface ResolvedModel extends ModelId {
  source: ModelSource;
  /** True when the model runs on this machine and nothing leaves it. */
  local: boolean;
}

export type ModelStatus = "ok" | "no_key" | "unreachable";

/** Splits on the FIRST slash: openrouter/anthropic/claude-sonnet-5 keeps its path. */
export function parseModelId(id: string): ModelId | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/**
 * A local provider is one whose traffic never leaves the machine: Ollama, or any
 * endpoint pointed at loopback. This is what makes "keep this agent local" a
 * promise rather than a label.
 */
export function isLocalProvider(config: ProviderConfig | undefined, providerId?: string): boolean {
  if (config === undefined) return false;
  if ((config.kind ?? providerId) === "ollama") return true;
  if (config.base_url === undefined) return false;
  try {
    return LOCAL_HOSTS.has(new URL(config.base_url).hostname);
  } catch {
    return false;
  }
}

function configured(providers: Record<string, ProviderConfig>, id: string): boolean {
  const p = providers[id];
  if (p === undefined) return false;
  // Ollama and other local endpoints need no key; everything else does.
  return isLocalProvider(p, id) || (p.api_key !== undefined && p.api_key.length > 0);
}

export interface ResolveOptions {
  agent: AgentConfig;
  agentsFile: AgentsFile;
  config: OfficeConfig;
  /** From the task bar. Refused for agents whose own model is local. */
  override?: string;
  /**
   * Provider ids that have a working adapter, which is not always what config
   * says: demo mode injects one with no providers block at all. When given, this
   * is the authority on whether a provider is usable.
   */
  available?: Iterable<string>;
}

export function resolveModel(options: ResolveOptions): ResolvedModel {
  const { agent, agentsFile, config, override } = options;
  const providers = config.providers;
  const available = options.available === undefined ? undefined : new Set(options.available);
  const usable = (id: string): boolean =>
    available === undefined ? configured(providers, id) : available.has(id);

  const agentOwn = agent.model === undefined ? undefined : parseModelId(agent.model);
  const agentIsLocal =
    agentOwn !== undefined && isLocalProvider(providers[agentOwn.provider], agentOwn.provider);

  if (override !== undefined) {
    const parsed = parseModelId(override);
    if (parsed === undefined) {
      throw new RunError("MODEL_NOT_FOUND", { provider: "?", model: override });
    }
    // An agent kept local stays local. The owner wrote that down on purpose.
    if (agentIsLocal && !isLocalProvider(providers[parsed.provider], parsed.provider)) {
      throw new RunError("MODEL_OVERRIDE_LEAVES_MACHINE", { agent: agent.name ?? agent.id });
    }
    return {
      ...parsed,
      source: "override",
      local: isLocalProvider(providers[parsed.provider], parsed.provider),
    };
  }

  if (agentOwn !== undefined) {
    if (!usable(agentOwn.provider)) {
      throw new RunError("PROVIDER_NOT_CONFIGURED", {
        agent: agent.name ?? agent.id,
        provider: agentOwn.provider,
      });
    }
    return { ...agentOwn, source: "agent", local: agentIsLocal };
  }

  const fromOffice =
    agentsFile.default_model === undefined ? undefined : parseModelId(agentsFile.default_model);
  if (fromOffice !== undefined && usable(fromOffice.provider)) {
    return {
      ...fromOffice,
      source: "office_default",
      local: isLocalProvider(providers[fromOffice.provider], fromOffice.provider),
    };
  }

  // Last resort: the first provider that is actually usable, in file order.
  const candidates = available === undefined ? Object.keys(providers) : [...available];
  for (const id of candidates) {
    if (!usable(id)) continue;
    const provider = providers[id];
    return {
      provider: id,
      model: defaultModelFor(id, provider),
      source: "first_provider",
      local: isLocalProvider(provider, id),
    };
  }

  throw new RunError("NO_MODEL_CONFIGURED", {});
}

/** Used only by the first_provider fallback; a real adapter's defaultModel() wins elsewhere. */
function defaultModelFor(id: string, provider: ProviderConfig | undefined): string {
  switch (provider?.kind ?? id) {
    case "anthropic":
      return "claude-sonnet-5";
    case "ollama":
      return "llama4";
    default:
      return "gpt-5-mini";
  }
}

/** What the office puts on each agent's badge. */
export function modelStatusFor(
  options: ResolveOptions & { reachable?: (provider: string) => boolean },
): ModelStatus {
  let resolved: ResolvedModel;
  try {
    resolved = resolveModel(options);
  } catch {
    return "no_key";
  }
  if (options.reachable !== undefined && !options.reachable(resolved.provider))
    return "unreachable";
  return "ok";
}
