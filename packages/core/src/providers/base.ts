/**
 * Shared machinery for adapters: token estimation, the tool-name mapping that
 * providers without dot support need, and pricing lookup.
 */
import type { Message, ModelPricing, ProviderAdapter, ToolSpec } from "./types.js";

/** Characters per token. Rough, and only used where the provider gives us nothing. */
const CHARS_PER_TOKEN = 3.5;
/** Per-message overhead for role and delimiters. */
const TOKENS_PER_MESSAGE = 4;

/**
 * A dot separates an MCP server from its tool. Anthropic accepts dots; OpenAI and
 * Ollama do not, so they see a double underscore instead. The loop and the tool
 * registry only ever deal in the dotted form.
 */
export function encodeToolName(name: string): string {
  return name.replace(".", "__");
}

export function decodeToolName(name: string): string {
  return name.replace("__", ".");
}

function messageText(m: Message): string {
  if (m.role === "assistant") {
    const calls = m.toolCalls?.map((c) => c.name + JSON.stringify(c.input)).join("") ?? "";
    return m.content + calls;
  }
  return m.content;
}

/**
 * Estimated prompt size. Billing never uses this: it uses `Usage` from the `done`
 * chunk. This is for deciding whether a prompt will fit before we send it.
 */
export function estimateTokens(messages: Message[], tools: ToolSpec[] = []): number {
  let chars = 0;
  for (const m of messages) chars += messageText(m).length;
  for (const t of tools)
    chars += t.name.length + t.description.length + JSON.stringify(t.inputSchema).length;
  return Math.ceil(chars / CHARS_PER_TOKEN) + messages.length * TOKENS_PER_MESSAGE;
}

export interface BaseAdapterOptions {
  /** `config.providers.<id>.pricing`, which wins over the shipped table. */
  pricingOverrides?: Record<string, ModelPricing>;
}

export abstract class BaseAdapter implements Partial<ProviderAdapter> {
  protected readonly pricingOverrides: Record<string, ModelPricing>;
  /** Prices shipped with the adapter, in US dollars per 1000 tokens. */
  protected abstract readonly pricingTable: Record<string, ModelPricing>;

  constructor(options: BaseAdapterOptions = {}) {
    this.pricingOverrides = options.pricingOverrides ?? {};
  }

  countTokens(messages: Message[], tools: ToolSpec[], _model: string): Promise<number> {
    return Promise.resolve(estimateTokens(messages, tools));
  }

  /**
   * Config first, then the shipped table, then null. A null price makes the run's
   * cost null and the office says "cost unknown" rather than guessing.
   */
  pricing(model: string): ModelPricing | null {
    return this.pricingOverrides[model] ?? this.pricingTable[model] ?? null;
  }

  protected encodeToolName = encodeToolName;
  protected decodeToolName = decodeToolName;
}
