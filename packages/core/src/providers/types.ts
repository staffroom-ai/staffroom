/**
 * The contract every model provider implements. Adding a provider must take under
 * 150 lines; if it does not, this interface is wrong and should change rather than
 * the adapter growing workarounds.
 */

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolCall {
  /** The provider's id, or `call_<n>` when the provider gives none (Ollama). */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * One optional dot separates an MCP server from its tool: `notion.search_pages`.
 * Providers that forbid dots see `notion__search_pages`; see `encodeToolName`.
 */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31})?$/;

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema draft 2020-12, object at the root. */
  inputSchema: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** True when the provider gave no usage and the adapter estimated it. */
  estimated?: boolean;
}

export type StopReason = "end" | "tool_calls" | "max_tokens";

export type CompletionChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason: StopReason; usage: Usage };

export interface CompleteOptions {
  /** Model half only: "claude-opus-5", not "anthropic/claude-opus-5". */
  model: string;
  maxTokens: number;
  temperature?: number;
  signal: AbortSignal;
  /** Routing forces "assign_task". Ignored by providers without forced tools. */
  forceTool?: string;
}

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsParallelToolCalls: boolean;
  supportsForcedTool: boolean;
  /** null means unknown; the loop assumes 32k. */
  maxContextTokens: number | null;
}

export interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
  cachedInputPer1k?: number;
}

export interface ModelInfo {
  id: string;
  /** ISO date, when the provider reports one. Settings > Models sorts by it. */
  created?: string;
}

export interface ProviderAdapter {
  /** The config key: "anthropic", "groq", "ollama". */
  readonly id: string;
  readonly kind: "anthropic" | "openai" | "ollama" | "demo";
  defaultModel(): string;
  capabilities(model: string): ProviderCapabilities;
  /**
   * Yields zero or more `text` chunks, zero or more `tool_call` chunks, then
   * exactly one `done`. On abort it throws AbortError and does not yield `done`.
   * Errors are thrown as ProviderError with the code already mapped. Adapters
   * never retry: that is the loop's job.
   */
  complete(
    messages: Message[],
    tools: ToolSpec[],
    opts: CompleteOptions,
  ): AsyncIterable<CompletionChunk>;
  countTokens(messages: Message[], tools: ToolSpec[], model: string): Promise<number>;
  pricing(model: string): ModelPricing | null;
  listModels(): Promise<ModelInfo[]>;
  /** Optional. Used by the brain when embeddings are switched on. */
  embed?(texts: string[], model: string): Promise<number[][]>;
}
