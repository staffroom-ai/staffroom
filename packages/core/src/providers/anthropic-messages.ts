/**
 * Our Message list to Anthropic's wire shape.
 *
 * A pure function, kept out of the adapter so the adapter stays inside the
 * 150-line budget that keeps "adding a provider is easy" honest, and so the
 * mapping can be tested without standing up a client.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Message } from "./types.js";

export interface AnthropicRequest {
  system?: string;
  messages: Anthropic.MessageParam[];
}

/**
 * Two rules the wire format forces: the system message becomes a top-level
 * parameter rather than a turn, and consecutive tool results merge into a single
 * user message of tool_result blocks.
 */
export function toAnthropicMessages(messages: Message[]): AnthropicRequest {
  let system: string | undefined;
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system = system === undefined ? m.content : `${system}\n\n${m.content}`;
      continue;
    }

    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content.length > 0) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    const block: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: m.toolCallId,
      content: m.content,
      ...(m.isError ? { is_error: true } : {}),
    };
    const previous = out.at(-1);
    if (previous?.role === "user" && Array.isArray(previous.content)) previous.content.push(block);
    else out.push({ role: "user", content: [block] });
  }

  return system === undefined ? { messages: out } : { system, messages: out };
}
