/**
 * Our Message list to the OpenAI chat-completions shape.
 *
 * Two things the protocol forces. Tool names may not contain a dot, so the
 * registry's `notion.search_pages` goes out as `notion__search_pages` and is
 * decoded on the way back. And a failed tool result has no wire representation,
 * so the content is prefixed to tell the model what happened.
 */
import type OpenAI from "openai";
import { encodeToolName } from "./base.js";
import type { CompleteOptions, Message, ToolSpec } from "./types.js";

export function toOpenAIMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const calls = m.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: m.content.length > 0 ? m.content : null,
        ...(calls.length === 0
          ? {}
          : {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: encodeToolName(c.name), arguments: JSON.stringify(c.input) },
              })),
            }),
      });
    } else {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.isError ? `ERROR: ${m.content}` : m.content,
      });
    }
  }
  return out;
}

export function toOpenAITools(tools: ToolSpec[]): OpenAI.ChatCompletionFunctionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: encodeToolName(t.name),
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * The full chat-completions body. `withUsage` is separate from the options because
 * the adapter retries without it when an endpoint refuses stream_options.
 */
export function toOpenAIRequest(
  messages: Message[],
  tools: ToolSpec[],
  opts: CompleteOptions,
  withUsage: boolean,
): OpenAI.ChatCompletionCreateParamsStreaming {
  return {
    model: opts.model,
    max_completion_tokens: opts.maxTokens,
    messages: toOpenAIMessages(messages),
    stream: true,
    ...(withUsage ? { stream_options: { include_usage: true } } : {}),
    ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    ...(tools.length === 0 ? {} : { tools: toOpenAITools(tools) }),
    ...(opts.forceTool === undefined
      ? {}
      : {
          tool_choice: {
            type: "function" as const,
            function: { name: encodeToolName(opts.forceTool) },
          },
        }),
  };
}
