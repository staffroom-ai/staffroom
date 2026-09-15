/**
 * What a tool is.
 *
 * The important default is `scope`: a tool whose author left it out is treated as
 * a write, so it goes through approval. Guessing "read" would mean a tool that
 * sends email runs unasked because someone forgot a line.
 */
import type { ZodType } from "zod";
import type { ApprovalPreview, BrainReader, ToolSource } from "../shared/types.js";

export type ToolScope = "read" | "write";

export interface ToolContext {
  agentId: string;
  department: string;
  runId: string;
  signal: AbortSignal;
  /** Becomes a tool_log event. Redacted like everything else. */
  log: (msg: string, data?: Record<string, unknown>) => void;
  brain: BrainReader;
}

export interface Tool<I extends ZodType = ZodType, O = unknown> {
  /** ^[a-z][a-z0-9_]{1,31}$, or server.tool for MCP. */
  name: string;
  description: string;
  input: I;
  scope: ToolScope;
  /** A write that never leaves this machine: no approval, but still recorded. */
  local?: boolean;
  /** Input is sent off this machine. Read tools with this set have a size limit. */
  egress?: boolean;
  /** Undefined means every department. */
  departments?: string[];
  timeoutMs?: number;
  preview?: (input: unknown) => ApprovalPreview;
  run: (input: unknown, ctx: ToolContext) => Promise<O>;
  /** Set by whichever loader registered it, never by the author. */
  source: ToolSource;
}

export const TOOL_NAME = /^[a-z][a-z0-9_]{1,31}$/;
export const MCP_TOOL_NAME = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{1,31}$/;

export class ToolNameInvalid extends Error {
  constructor(name: string) {
    super(
      `"${name}" is not a usable tool name. Use lowercase letters, digits and underscores, ` +
        "two to thirty-two characters, for example lookup_order.",
    );
    this.name = "ToolNameInvalid";
  }
}

export interface ToolDefinition<I extends ZodType, O> extends Omit<Tool<I, O>, "source" | "scope"> {
  scope?: ToolScope;
}

/**
 * The only public constructor. Frozen on the way out so a tool cannot be edited
 * after registration and quietly change what the whitelist matched against.
 */
export function tool<I extends ZodType, O>(definition: ToolDefinition<I, O>): Tool<I, O> {
  if (!TOOL_NAME.test(definition.name) && !MCP_TOOL_NAME.test(definition.name)) {
    throw new ToolNameInvalid(definition.name);
  }
  return Object.freeze({
    ...definition,
    // Missing scope means write. The server raises an Activity card saying so.
    scope: definition.scope ?? "write",
    source: { kind: "custom", file: "unknown" } as ToolSource,
  }) as Tool<I, O>;
}

/** True when the author never said. The server tells the owner about these. */
export function scopeWasAssumed(definition: { scope?: ToolScope }): boolean {
  return definition.scope === undefined;
}
