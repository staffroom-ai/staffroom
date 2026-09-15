/**
 * The tool-call delta state machine.
 *
 * OpenAI streams a tool call in pieces, and pieces for several calls interleave,
 * identified only by an index. This collects them and hands back finished calls
 * when the choice reports a finish reason.
 */
import type OpenAI from "openai";
import { decodeToolName } from "./base.js";
import type { ToolCall } from "./types.js";

export class ToolCallBuffer {
  private readonly parts = new Map<number, { id: string; name: string; args: string }>();

  add(deltas: OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall[]): void {
    for (const call of deltas) {
      const part = this.parts.get(call.index) ?? { id: "", name: "", args: "" };
      if (call.id) part.id = call.id;
      // Name and arguments both arrive split across deltas, so both append.
      if (call.function?.name) part.name += call.function.name;
      if (call.function?.arguments) part.args += call.function.arguments;
      this.parts.set(call.index, part);
    }
  }

  /** Finished calls in index order, emptying the buffer. */
  flush(): ToolCall[] {
    const out = [...this.parts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, part]) => ({
        // Some compatible endpoints omit the id entirely; position stands in for it.
        id: part.id.length > 0 ? part.id : `call_${index + 1}`,
        name: decodeToolName(part.name),
        input: parseArguments(part.args),
      }));
    this.parts.clear();
    return out;
  }
}

/** Arguments that do not parse still reach the loop, which returns a tool error to the model. */
export function parseArguments(args: string): Record<string, unknown> {
  if (args.trim().length === 0) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return { _raw: args };
  }
}
