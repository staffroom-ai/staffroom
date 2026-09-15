/**
 * Ollama adapter: models running on this machine.
 *
 * This is the privacy story. An agent on an Ollama model sends nothing off the
 * computer, which is why resolveModel refuses to override one onto a hosted model.
 *
 * Two quirks shape the code. Ollama returns no ids for tool calls, so the adapter
 * assigns them by position and results are matched the same way. And whether a
 * model supports tools at all is a property of the model, not the server, so it is
 * asked once per model and remembered.
 */
import { Ollama } from "ollama";
import { BaseAdapter, type BaseAdapterOptions, decodeToolName, encodeToolName } from "./base.js";
import { mapOllamaError } from "./ollama-errors.js";
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

export interface OllamaAdapterOptions extends BaseAdapterOptions {
  baseUrl?: string;
  id?: string;
}

export class OllamaAdapter extends BaseAdapter implements ProviderAdapter {
  readonly id: string;
  readonly kind = "ollama" as const;
  /** Nothing was billed. A zero price would imply a metered call that cost nothing. */
  protected readonly pricingTable: Record<string, ModelPricing> = {};
  private readonly client: Ollama;
  private readonly toolSupport = new Map<string, boolean>();

  constructor(options: OllamaAdapterOptions = {}) {
    super(options);
    this.id = options.id ?? "ollama";
    this.client = new Ollama({ host: options.baseUrl ?? "http://127.0.0.1:11434" });
  }

  defaultModel(): string {
    return "llama4";
  }

  capabilities(model: string): ProviderCapabilities {
    return {
      // Assumed true until show() says otherwise; hasTools() is the authority.
      supportsTools: this.toolSupport.get(model) ?? true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      // No forced tool choice, so routing uses the JSON-in-text path instead.
      supportsForcedTool: false,
      maxContextTokens: null,
    };
  }

  /** Asked once per model: tool support is a property of the model's template. */
  async hasTools(model: string): Promise<boolean> {
    const cached = this.toolSupport.get(model);
    if (cached !== undefined) return cached;
    try {
      const info = (await this.client.show({ model })) as {
        capabilities?: string[];
        template?: string;
      };
      const supported =
        info.capabilities?.includes("tools") ??
        /\.Tools|ToolCalls|tool_calls/i.test(info.template ?? "");
      this.toolSupport.set(model, supported);
      return supported;
    } catch {
      // A failure here is not a reason to refuse the run; the call itself will say.
      return true;
    }
  }

  override pricing(_model: string): ModelPricing | null {
    return null;
  }

  async *complete(
    messages: Message[],
    tools: ToolSpec[],
    opts: CompleteOptions,
  ): AsyncIterable<CompletionChunk> {
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: StopReason = "end";
    let callIndex = 0;

    try {
      const stream = await this.client.chat({
        model: opts.model,
        stream: true,
        messages: messages.map(toOllamaMessage),
        ...(opts.temperature === undefined ? {} : { options: { temperature: opts.temperature } }),
        ...(tools.length === 0
          ? {}
          : {
              tools: tools.map((t) => ({
                type: "function" as const,
                function: {
                  name: encodeToolName(t.name),
                  description: t.description,
                  parameters: t.inputSchema,
                },
              })),
            }),
      });

      for await (const part of stream) {
        if (opts.signal.aborted) {
          stream.abort?.();
          throw new DOMException("Aborted", "AbortError");
        }

        if (part.message?.content) yield { type: "text", text: part.message.content };

        for (const call of part.message?.tool_calls ?? []) {
          callIndex++;
          yield {
            type: "tool_call",
            call: {
              // Ollama sends no id, so position is the only thing to match on.
              id: `call_${callIndex}`,
              name: decodeToolName(call.function.name),
              input: (call.function.arguments ?? {}) as Record<string, unknown>,
            },
          };
          stopReason = "tool_calls";
        }

        if (part.done) {
          usage = { inputTokens: part.prompt_eval_count ?? 0, outputTokens: part.eval_count ?? 0 };
          if (part.done_reason === "length") stopReason = "max_tokens";
        }
      }
    } catch (error) {
      throw mapOllamaError(error, opts.model);
    }

    yield { type: "done", stopReason, usage };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const list = await this.client.list();
      return list.models
        .map((m) => ({
          id: m.name,
          ...(m.modified_at ? { created: new Date(m.modified_at).toISOString() } : {}),
        }))
        .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
    } catch (error) {
      throw mapOllamaError(error, "");
    }
  }
}

function toOllamaMessage(m: Message): { role: string; content: string } {
  if (m.role === "tool") {
    return { role: "tool", content: m.isError ? `ERROR: ${m.content}` : m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    // Tool calls are replayed as text: without ids there is nothing to correlate.
    const calls = m.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join("\n");
    return { role: "assistant", content: m.content.length > 0 ? `${m.content}\n${calls}` : calls };
  }
  return { role: m.role, content: m.content };
}
