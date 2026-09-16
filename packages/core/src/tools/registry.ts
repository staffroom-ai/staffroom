/**
 * The tool registry, and the approval gate.
 *
 * `invoke` is the only path from an agent to a tool, which is what makes the
 * safety rule enforceable rather than advisory. Everything goes through the same
 * order: validate, apply the egress limit, decide whether the owner must approve,
 * run under a timeout, record.
 */
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { z } from "zod";
import type { AgentConfig } from "../config/agents.js";
import type { OfficeConfig } from "../config/config.js";
import { newApprovalId } from "../runtime/store.js";
import type { ApprovalBy, ApprovalDecision, ApprovalPreview } from "../shared/types.js";
import { buildPreview } from "./preview.js";
import type { Tool, ToolContext } from "./tool.js";

export type ToolErrorCode =
  | "not_found"
  | "not_allowed"
  | "invalid_input"
  | "approval_denied"
  | "approval_expired"
  | "approval_lost"
  | "timeout"
  | "server_unavailable"
  | "handler_error";

export type ToolResult =
  | { ok: true; output: unknown; durationMs: number; noteIds?: string[] }
  | { ok: false; error: { code: ToolErrorCode; message: string }; durationMs: number };

export interface RegisteredTool {
  tool: Tool;
  inputSchema: Record<string, unknown>;
  /** sha256 of name, description and schema. The whitelist matches on this. */
  fingerprint: string;
  registeredAt: number;
}

export class ToolNameConflict extends Error {
  constructor(name: string) {
    super(`A tool called "${name}" is already registered.`);
    this.name = "ToolNameConflict";
  }
}

/**
 * Permissions the owner has already given. A whitelist that is absent says no to
 * everything, which is the right default: an office with no recorded permissions
 * asks about every write.
 */
export interface Whitelist {
  allows(tool: Tool, input: unknown, fingerprint: string, agentId: string): boolean;
  /** True when a row exists but was suspended because the tool changed. */
  changedSinceAllowed?(agentId: string, tool: string, input: unknown): boolean;
}

export const DENY_ALL: Whitelist = { allows: () => false };

/** The three brain tools every agent gets without listing them. */
export const IMPLIED_TOOLS = new Set(["brain_search", "brain_read", "brain_write"]);
const WEB_ALIAS = "web";
const WEB_TOOL = "web_search";

export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  toolCallId: string;
  tool: { name: string; source: Tool["source"]; scope: "write" };
  input: unknown;
  preview: ApprovalPreview;
  requestedAt: number;
  expiresAt: number;
}

export interface ToolRegistryOptions {
  config: OfficeConfig;
  whitelist?: Whitelist;
  /** Called when the owner chooses "approve and always allow". */
  onGrant?: (grant: { agentId: string; tool: string; input: unknown; fingerprint: string }) => void;
  /** Called when a write needs the owner. The server turns this into events and a card. */
  onApprovalNeeded?: (request: ApprovalRequest) => void;
  /** Called for a local write, which is recorded but never blocks. */
  onLocalWrite?: (request: ApprovalRequest) => void;
  /** Called whenever an approval is settled, however it was settled. */
  onApprovalResolved?: (outcome: {
    approvalId: string;
    runId: string;
    decision: ApprovalDecision;
    by: ApprovalBy;
    note?: string;
  }) => void;
}

interface Waiting {
  resolve: (outcome: { decision: ApprovalDecision; by: ApprovalBy; note?: string }) => void;
  request: ApprovalRequest;
}

export class ToolRegistry extends EventEmitter {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly waiting = new Map<string, Waiting>();
  private readonly config: OfficeConfig;
  private readonly whitelist: Whitelist;
  private readonly options: ToolRegistryOptions;

  constructor(options: ToolRegistryOptions) {
    super();
    this.config = options.config;
    this.whitelist = options.whitelist ?? DENY_ALL;
    this.options = options;
  }

  /** ToolNameResolver, so config validation can check names without importing this. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new ToolNameConflict(tool.name);
    const inputSchema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
    const fingerprint = createHash("sha256")
      .update(tool.name + tool.description + JSON.stringify(inputSchema))
      .digest("hex");
    this.tools.set(tool.name, { tool, inputSchema, fingerprint, registeredAt: Date.now() });
    this.emit("registered", tool.name);
  }

  unregister(name: string): void {
    if (this.tools.delete(name)) this.emit("unregistered", name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  /** The four filters, in order, stopping at the first failure. */
  forAgent(agent: AgentConfig, config: OfficeConfig = this.config): RegisteredTool[] {
    const listed = new Set(agent.tools);
    const wantsWeb = listed.has(WEB_ALIAS) || listed.has(WEB_TOOL);

    return this.list().filter(({ tool }) => {
      const server = tool.source.kind === "mcp" ? tool.source.server : undefined;

      // 1. implied, listed by name, listed by MCP server prefix, or the web alias
      const allowed =
        IMPLIED_TOOLS.has(tool.name) ||
        listed.has(tool.name) ||
        (server !== undefined && listed.has(server)) ||
        (tool.name === WEB_TOOL && wantsWeb);
      if (!allowed) return false;

      // 2. the tool's own department restriction
      if (tool.departments !== undefined && !tool.departments.includes(agent.department))
        return false;

      if (server !== undefined) {
        // 3. the office's wiring for that server
        const wiredTo = config.mcp.departments[server];
        if (wiredTo !== undefined && !wiredTo.includes(agent.department)) return false;
        // 4. the deny list wins over everything
        if (config.mcp.deny.includes(server)) return false;
      }

      return true;
    });
  }

  /**
   * Resolves a pending approval. Called by the server when the owner clicks, and
   * by the boot sequence when an approval is expired.
   */
  /**
   * The card, plus the one thing the owner cannot see for themselves: that they
   * allowed this before and the tool is not what it was.
   */
  private previewFor(tool: Tool, input: unknown, agentId: string): ApprovalPreview {
    const preview = buildPreview(tool, input);
    const changed = this.whitelist.changedSinceAllowed?.(agentId, tool.name, input) === true;
    return changed
      ? {
          ...preview,
          changedSinceAllowed:
            "You allowed this before, but the tool has changed since. Please look again.",
        }
      : preview;
  }

  resolve(approvalId: string, decision: ApprovalDecision, by: ApprovalBy, note?: string): boolean {
    const pending = this.waiting.get(approvalId);
    if (pending === undefined) return false;
    this.waiting.delete(approvalId);
    this.options.onApprovalResolved?.({
      approvalId,
      runId: pending.request.runId,
      decision,
      by,
      ...(note === undefined ? {} : { note }),
    });
    pending.resolve(note === undefined ? { decision, by } : { decision, by, note });
    return true;
  }

  pending(): ApprovalRequest[] {
    return [...this.waiting.values()].map((w) => w.request);
  }

  async invoke(
    name: string,
    rawInput: unknown,
    ctx: ToolContext & { toolCallId?: string },
  ): Promise<ToolResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;

    const registered = this.tools.get(name);
    if (registered === undefined) {
      return {
        ok: false,
        error: { code: "not_found", message: `There is no tool called "${name}".` },
        durationMs: elapsed(),
      };
    }

    const { tool } = registered;

    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: `Input to ${name} is not valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`,
        },
        durationMs: elapsed(),
      };
    }
    const input = parsed.data;

    // A read tool that ships its input off the machine is limited by size. Writes
    // are not limited here, because their whole input is shown in the preview.
    const inputChars = JSON.stringify(input ?? {}).length;
    const limit = this.config.runner.egress_input_max_chars;
    if (tool.egress === true && tool.scope === "read" && inputChars > limit) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: `Input to ${name} is over ${limit} characters; this tool sends its input off this computer.`,
        },
        durationMs: elapsed(),
      };
    }

    if (tool.scope === "write") {
      const gate = await this.gate(registered, input, ctx, started);
      if (gate !== undefined) return gate;
    }

    return this.runTool(registered, input, ctx, started);
  }

  /** Returns a result when the run must stop, or undefined when it may proceed. */
  private async gate(
    registered: RegisteredTool,
    input: unknown,
    ctx: ToolContext & { toolCallId?: string },
    started: number,
  ): Promise<ToolResult | undefined> {
    const { tool, fingerprint } = registered;
    const elapsed = () => Date.now() - started;

    const request: ApprovalRequest = {
      approvalId: newApprovalId(),
      runId: ctx.runId,
      toolCallId: ctx.toolCallId ?? "unknown",
      tool: { name: tool.name, source: tool.source, scope: "write" },
      input,
      preview: this.previewFor(tool, input, ctx.agentId),
      requestedAt: Date.now(),
      expiresAt: Date.now() + this.config.approvals.expiry_hours * 3_600_000,
    };

    // A write that never leaves the machine is recorded, not blocked: the owner
    // can see it happened without being asked about every file write.
    if (tool.local === true) {
      this.options.onLocalWrite?.(request);
      return undefined;
    }

    if (this.whitelist.allows(tool, input, fingerprint, ctx.agentId)) {
      this.options.onLocalWrite?.(request);
      return undefined;
    }

    this.options.onApprovalNeeded?.(request);

    const outcome = await new Promise<{
      decision: ApprovalDecision;
      by: ApprovalBy;
      note?: string;
    }>((resolve) => {
      this.waiting.set(request.approvalId, { resolve, request });
      // A cancelled run must not leave a tool waiting forever.
      if (ctx.signal.aborted) {
        this.waiting.delete(request.approvalId);
        resolve({ decision: "cancelled", by: "system" });
        return;
      }
      ctx.signal.addEventListener(
        "abort",
        () => {
          if (this.waiting.delete(request.approvalId))
            resolve({ decision: "cancelled", by: "system" });
        },
        { once: true },
      );
    });

    switch (outcome.decision) {
      case "approve":
        return undefined;
      case "approve_always":
        // Recorded first, then the call proceeds. If writing the permission
        // fails the call still goes through: the owner said yes, and refusing
        // it because a file could not be written would be its own surprise.
        try {
          this.options.onGrant?.({
            agentId: ctx.agentId,
            tool: tool.name,
            input,
            fingerprint,
          });
        } catch {
          // Reported by whoever owns the file, not by failing the call.
        }
        return undefined;
      case "deny":
        return {
          ok: false,
          error: { code: "approval_denied", message: "The owner declined this action." },
          durationMs: elapsed(),
        };
      case "expired":
        return {
          ok: false,
          error: {
            code: "approval_expired",
            message: "The request timed out waiting for the owner. Ask again if it still matters.",
          },
          durationMs: elapsed(),
        };
      default:
        return {
          ok: false,
          error: { code: "cancelled" as ToolErrorCode, message: "The run was stopped." },
          durationMs: elapsed(),
        };
    }
  }

  private async runTool(
    registered: RegisteredTool,
    input: unknown,
    ctx: ToolContext,
    started: number,
  ): Promise<ToolResult> {
    const { tool } = registered;
    const timeoutMs = tool.timeoutMs ?? this.config.runner.tool_timeout_ms;
    const elapsed = () => Date.now() - started;

    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const output = await Promise.race([
        tool.run(input, ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ToolTimeout()), timeoutMs);
          timer.unref?.();
        }),
        // Tools are handed the signal and are expected to honour it, but Stop has
        // to stop even when one does not. Without this a cancelled run waits out
        // the full tool timeout.
        new Promise<never>((_, reject) => {
          if (ctx.signal.aborted) {
            reject(new ToolCancelled());
            return;
          }
          onAbort = () => reject(new ToolCancelled());
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      const noteIds = extractNoteIds(output);
      return noteIds === undefined
        ? { ok: true, output, durationMs: elapsed() }
        : { ok: true, output, durationMs: elapsed(), noteIds };
    } catch (error) {
      if (error instanceof ToolCancelled) {
        return {
          ok: false,
          error: { code: "cancelled" as ToolErrorCode, message: "The run was stopped." },
          durationMs: elapsed(),
        };
      }
      if (error instanceof ToolTimeout) {
        return {
          ok: false,
          error: {
            code: "timeout",
            message: `${tool.name} took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
          },
          durationMs: elapsed(),
        };
      }
      return {
        ok: false,
        error: {
          code: "handler_error",
          message: error instanceof Error ? error.message : String(error),
        },
        durationMs: elapsed(),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) ctx.signal.removeEventListener("abort", onAbort);
    }
  }
}

class ToolTimeout extends Error {}
class ToolCancelled extends Error {}

/** The brain tools return note ids, which the loop copies onto the tool_result event. */
function extractNoteIds(output: unknown): string[] | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const ids = (output as { noteIds?: unknown }).noteIds;
  if (Array.isArray(ids) && ids.every((i) => typeof i === "string")) return ids as string[];
  return undefined;
}
