/**
 * OpenAI-compatible adapter. Also serves Groq, Together, OpenRouter, LM Studio and
 * anything else speaking chat-completions: point `baseURL` at it and give it an id.
 */
import OpenAI from "openai";
import { BaseAdapter, type BaseAdapterOptions, estimateTokens } from "./base.js";
import { isStreamOptionsRejection, mapOpenAIError } from "./openai-errors.js";
import { toOpenAIRequest } from "./openai-messages.js";
import { ToolCallBuffer } from "./openai-stream.js";
import { OPENAI_PRICING } from "./pricing.js";
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
  tool_calls: "tool_calls",
  function_call: "tool_calls",
  stop: "end",
  length: "max_tokens",
};

export interface OpenAIAdapterOptions extends BaseAdapterOptions {
  apiKey: string;
  baseURL?: string;
  id?: string;
  /** Display name used in error messages. Defaults to the id, capitalised. */
  label?: string;
  /** Set false for an endpoint known to reject stream_options; otherwise auto-detected. */
  streamUsage?: boolean;
  maxContextTokens?: number | null;
}

export class OpenAIAdapter extends BaseAdapter implements ProviderAdapter {
  readonly id: string;
  readonly kind = "openai" as const;
  protected readonly pricingTable: Record<string, ModelPricing>;
  private readonly client: OpenAI;
  private readonly label: string;
  private readonly maxContextTokens: number | null;
  /**
   * Whether this endpoint accepts stream_options. A single 400 flips it off for the
   * life of the process, so we never send it twice to an endpoint that refused it.
   */
  private streamUsage: boolean;

  constructor(options: OpenAIAdapterOptions) {
    super(options);
    this.id = options.id ?? "openai";
    this.label = options.label ?? this.id.charAt(0).toUpperCase() + this.id.slice(1);
    this.streamUsage = options.streamUsage ?? true;
    this.maxContextTokens = options.maxContextTokens ?? null;
    // Only openai.com prices from the shipped table; a compatible endpoint uses config.
    this.pricingTable = this.id === "openai" ? OPENAI_PRICING : {};
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    });
  }

  defaultModel(): string {
    return "gpt-5-mini";
  }

  capabilities(_model: string): ProviderCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsForcedTool: true,
      maxContextTokens: this.maxContextTokens,
    };
  }

  /** Opens the stream, retrying once without stream_options if the endpoint refuses it. */
  private async open(messages: Message[], tools: ToolSpec[], opts: CompleteOptions) {
    try {
      return await this.client.chat.completions.create(
        toOpenAIRequest(messages, tools, opts, this.streamUsage),
        { signal: opts.signal },
      );
    } catch (error) {
      if (!this.streamUsage || !isStreamOptionsRejection(error))
        throw mapOpenAIError(error, this.label);
      this.streamUsage = false;
      try {
        return await this.client.chat.completions.create(
          toOpenAIRequest(messages, tools, opts, false),
          { signal: opts.signal },
        );
      } catch (retryError) {
        throw mapOpenAIError(retryError, this.label);
      }
    }
  }

  async *complete(
    messages: Message[],
    tools: ToolSpec[],
    opts: CompleteOptions,
  ): AsyncIterable<CompletionChunk> {
    const buffer = new ToolCallBuffer();
    let usage: Usage | undefined;
    let stopReason: StopReason = "end";
    const stream = await this.open(messages, tools, opts);

    try {
      for await (const part of stream) {
        if (part.usage) {
          const cached = part.usage.prompt_tokens_details?.cached_tokens;
          usage = {
            inputTokens: part.usage.prompt_tokens,
            outputTokens: part.usage.completion_tokens,
            ...(cached ? { cachedInputTokens: cached } : {}),
          };
        }
        const choice = part.choices[0];
        if (!choice) continue;

        if (choice.delta?.content) yield { type: "text", text: choice.delta.content };
        if (choice.delta?.tool_calls) buffer.add(choice.delta.tool_calls);

        if (choice.finish_reason) {
          stopReason = STOP[choice.finish_reason] ?? "end";
          for (const call of buffer.flush()) yield { type: "tool_call", call };
        }
      }
    } catch (error) {
      throw mapOpenAIError(error, this.label);
    }

    yield {
      type: "done",
      stopReason,
      usage: usage ?? {
        inputTokens: estimateTokens(messages, tools),
        outputTokens: 0,
        estimated: true,
      },
    };
  }

  /** An endpoint without a models route returns nothing, and setup falls back to a free-text field. */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const page = await this.client.models.list();
      return page.data
        .map((m) => ({
          id: m.id,
          ...(m.created ? { created: new Date(m.created * 1000).toISOString() } : {}),
        }))
        .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
    } catch (error) {
      const mapped = mapOpenAIError(error, this.label);
      if (mapped instanceof Error && "status" in mapped && mapped.status === 404) return [];
      throw mapped;
    }
  }
}
