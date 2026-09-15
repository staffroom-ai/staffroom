/**
 * Anthropic adapter. Uses @anthropic-ai/sdk (MIT), never the proprietary agent SDK.
 * Errors are mapped in anthropic-errors.ts and never retried here: retry policy
 * belongs to the loop.
 */
import Anthropic from "@anthropic-ai/sdk";
import { mapAnthropicError } from "./anthropic-errors.js";
import { toAnthropicMessages } from "./anthropic-messages.js";
import { BaseAdapter, type BaseAdapterOptions } from "./base.js";
import { ANTHROPIC_PRICING } from "./pricing.js";
import type {
  CompleteOptions,
  CompletionChunk,
  Message,
  ModelInfo,
  ModelPricing,
  ProviderAdapter,
  ProviderCapabilities,
  StopReason,
  ToolSpec,
  Usage,
} from "./types.js";

const STOP: Record<string, StopReason> = {
  tool_use: "tool_calls",
  end_turn: "end",
  stop_sequence: "end",
  max_tokens: "max_tokens",
};

/** Anthropic accepts dots in tool names, so no name encoding is needed here. */
export class AnthropicAdapter extends BaseAdapter implements ProviderAdapter {
  readonly id: string;
  readonly kind = "anthropic" as const;
  protected readonly pricingTable: Record<string, ModelPricing> = ANTHROPIC_PRICING;
  private readonly client: Anthropic;

  constructor(options: BaseAdapterOptions & { apiKey: string; baseURL?: string; id?: string }) {
    super(options);
    this.id = options.id ?? "anthropic";
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    });
  }

  defaultModel(): string {
    return "claude-sonnet-5";
  }

  capabilities(model: string): ProviderCapabilities {
    const claude5 = model.startsWith("claude-opus-5") || model.startsWith("claude-sonnet-5");
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsForcedTool: true,
      maxContextTokens: claude5 ? 200_000 : null,
    };
  }

  async *complete(
    messages: Message[],
    tools: ToolSpec[],
    opts: CompleteOptions,
  ): AsyncIterable<CompletionChunk> {
    const { system, messages: converted } = toAnthropicMessages(messages);
    const buffers = new Map<number, { id: string; name: string; json: string }>();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: StopReason = "end";

    try {
      const stream = this.client.messages.stream(
        {
          model: opts.model,
          max_tokens: opts.maxTokens,
          messages: converted,
          ...(system === undefined ? {} : { system }),
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
          ...(tools.length === 0
            ? {}
            : {
                tools: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                })),
              }),
          ...(opts.forceTool === undefined
            ? {}
            : { tool_choice: { type: "tool" as const, name: opts.forceTool } }),
        },
        { signal: opts.signal },
      );

      for await (const event of stream) {
        if (event.type === "message_start") {
          const u = event.message.usage;
          usage = {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            ...(u.cache_read_input_tokens ? { cachedInputTokens: u.cache_read_input_tokens } : {}),
          };
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          buffers.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            json: "",
          });
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
          else if (event.delta.type === "input_json_delta") {
            const b = buffers.get(event.index);
            if (b) b.json += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const b = buffers.get(event.index);
          if (b) {
            buffers.delete(event.index);
            yield {
              type: "tool_call",
              call: { id: b.id, name: b.name, input: parseInput(b.json) },
            };
          }
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason) stopReason = STOP[event.delta.stop_reason] ?? "end";
          usage = { ...usage, outputTokens: event.usage.output_tokens };
        }
      }
    } catch (error) {
      throw mapAnthropicError(error);
    }
    yield { type: "done", stopReason, usage };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const page = await this.client.models.list({ limit: 100 });
      return page.data
        .map((m) => ({ id: m.id, ...(m.created_at ? { created: m.created_at } : {}) }))
        .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

/** Arguments that do not parse still reach the loop, which returns a tool error to the model. */
function parseInput(json: string): Record<string, unknown> {
  if (json.trim().length === 0) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { _raw: json };
  }
}
