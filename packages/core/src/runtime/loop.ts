/**
 * The turn loop: ask the model, run what it asked for, repeat until it stops.
 *
 * Everything the office shows comes out of here as events, in order, so a run can
 * be replayed after a refresh or resumed after a restart. Three things are worth
 * knowing before reading:
 *
 * Retries live here, not in the adapters, so every provider retries the same way.
 * Tool results are wrapped in a trust="untrusted" element, because a search result
 * is data and the model is told so by the safety rule.
 * The loop never writes to the brain directly: it calls the same brain_write tool
 * the model would, so the audit trail looks identical either way.
 */
import { ulid } from "ulid";
import type {
  CompletionChunk,
  Message,
  ModelPricing,
  ProviderAdapter,
  ToolCall,
  ToolSpec,
  Usage,
} from "../providers/types.js";
import type { BrainReader } from "../shared/types.js";
import type { RegisteredTool, ToolRegistry, ToolResult } from "../tools/registry.js";
import type { ToolContext } from "../tools/tool.js";
import { ProviderError, RunError } from "./errors.js";
import type { RunEvent, RunKind, RunStore } from "./events.js";
import { deliverableTitle } from "./events.js";

export interface LoopRunnerConfig {
  maxTurns: number;
  maxParallelTools: number;
  maxOutputTokens: number;
  toolOutputMaxChars: number;
  temperature?: number;
  retries: { attempts: number; baseMs: number; maxMs: number };
}

export interface LoopContext {
  runId: string;
  kind: RunKind;
  agentId: string;
  department: string;
  adapter: ProviderAdapter;
  model: string;
  modelSource: string;
  pricing: ModelPricing | null;
  prompt: string;
  systemPrompt: string;
  systemPromptHash: string;
  pinnedIncluded: string[];
  pinnedTruncated: string[];
  tools: ToolRegistry;
  allowedTools: RegisteredTool[];
  store: RunStore;
  brain: BrainReader;
  signal: AbortSignal;
  config: LoopRunnerConfig;
  parentRunId: string | null;
  routineId: string | null;
  /** Prior turns, for chat and resume. The system message is added here. */
  priorMessages?: Message[];
  /** Note id this run revises, passed through to the deliverable. */
  revises?: string;
  /** Writes the deliverable. Injected so the loop does not depend on the filesystem. */
  writeDeliverable?: (args: {
    title: string;
    body: string;
    revises?: string;
  }) => Promise<{ noteId: string }>;
  /** A chat reply only becomes a note when it starts with a "# " line. */
  writeOnlyTitledDeliverable?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toToolSpecs(tools: RegisteredTool[]): ToolSpec[] {
  return tools.map((t) => ({
    name: t.tool.name,
    description: t.tool.description,
    inputSchema: t.inputSchema,
  }));
}

export function costOf(usage: Usage, pricing: ModelPricing | null): number | null {
  if (pricing === null) return null;
  const cached = usage.cachedInputTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cached);
  const cachedRate = pricing.cachedInputPer1k ?? pricing.inputPer1k;
  return (
    (fresh / 1000) * pricing.inputPer1k +
    (cached / 1000) * cachedRate +
    (usage.outputTokens / 1000) * pricing.outputPer1k
  );
}

interface TurnResult {
  text: string;
  calls: ToolCall[];
  stop: "end" | "tool_calls" | "max_tokens";
  usage: Usage;
}

/**
 * One model call, retried on the errors that are worth retrying. Partial text from
 * a failed attempt stays in the log with its attempt number, so a reader can see
 * the run stuttered rather than wondering why the text restarted.
 */
async function completeWithRetry(
  ctx: LoopContext,
  messages: Message[],
  turn: number,
): Promise<TurnResult> {
  const { attempts, baseMs, maxMs } = ctx.config.retries;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts + 1; attempt++) {
    let text = "";
    const calls: ToolCall[] = [];
    let stop: TurnResult["stop"] = "end";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

    try {
      const stream = ctx.adapter.complete(messages, toToolSpecs(ctx.allowedTools), {
        model: ctx.model,
        maxTokens: ctx.config.maxOutputTokens,
        signal: ctx.signal,
        ...(ctx.config.temperature === undefined ? {} : { temperature: ctx.config.temperature }),
      });

      for await (const chunk of stream as AsyncIterable<CompletionChunk>) {
        if (chunk.type === "text") {
          text += chunk.text;
          await ctx.store.append(ctx.runId, { type: "chunk", turn, attempt, text: chunk.text });
        } else if (chunk.type === "tool_call") {
          calls.push(chunk.call);
        } else {
          stop = chunk.stopReason;
          usage = chunk.usage;
        }
      }
      return { text, calls, stop, usage };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt > attempts || ctx.signal.aborted) break;

      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const jitter = backoff * 0.25 * Math.random();
      await sleep((error as ProviderError).retryAfterMs ?? backoff + jitter);
    }
  }
  throw lastError;
}

/** Runs everything the model asked for this turn and returns the tool messages. */
async function dispatchToolBatch(
  ctx: LoopContext,
  calls: ToolCall[],
  turn: number,
): Promise<Message[]> {
  const group = ulid();
  const allowed = new Map(ctx.allowedTools.map((t) => [t.tool.name, t]));

  const toolCtx = (call: ToolCall): ToolContext & { toolCallId: string } => ({
    agentId: ctx.agentId,
    department: ctx.department,
    runId: ctx.runId,
    toolCallId: call.id,
    signal: ctx.signal,
    log: (msg, data) => {
      void ctx.store.append(ctx.runId, {
        type: "tool_log",
        toolCallId: call.id,
        msg,
        ...(data === undefined ? {} : { data }),
      });
    },
    brain: ctx.brain,
  });

  const settle = async (call: ToolCall): Promise<Message> => {
    const registered = allowed.get(call.name);

    // 1. A tool the agent may not use is a result, not a crash: the model is told
    // and can choose something else.
    if (registered === undefined) {
      const content = `Tool "${call.name}" is not available to you. Say so in your reply and stop.`;
      await ctx.store.append(ctx.runId, {
        type: "tool_result",
        toolCallId: call.id,
        name: call.name,
        output: content,
        isError: true,
        durationMs: 0,
        truncated: false,
        redactedCount: 0,
      });
      return { role: "tool", toolCallId: call.id, name: call.name, content, isError: true };
    }

    // 2. Recorded before it runs, so a run waiting on approval is visible.
    const inputChars = JSON.stringify(call.input ?? {}).length;
    await ctx.store.append(ctx.runId, {
      type: "tool_call",
      turn,
      call,
      scope: registered.tool.scope,
      egress: registered.tool.egress === true,
      inputChars,
      group,
    });

    // 3. invoke is the gate; it blocks on approval for a non-local write.
    const result: ToolResult = await ctx.tools.invoke(call.name, call.input, toolCtx(call));

    // 4. Wrapped as untrusted, because a tool result is data, not instruction.
    const raw = result.ok ? JSON.stringify(result.output) : result.error.message;
    const truncated = raw.length > ctx.config.toolOutputMaxChars;
    const body = truncated ? `${raw.slice(0, ctx.config.toolOutputMaxChars)}\n[truncated]` : raw;
    const content = `<tool_result name="${call.name}" trust="untrusted">\n${body}\n</tool_result>`;

    await ctx.store.append(ctx.runId, {
      type: "tool_result",
      toolCallId: call.id,
      name: call.name,
      output: body,
      isError: !result.ok,
      durationMs: result.durationMs,
      truncated,
      redactedCount: 0,
      ...(result.ok && result.noteIds !== undefined ? { noteIds: result.noteIds } : {}),
    });

    return { role: "tool", toolCallId: call.id, name: call.name, content, isError: !result.ok };
  };

  // Reads run in parallel up to the cap; writes wait on the owner and simply take
  // longer. Results go back in the order the calls were issued, whatever order
  // they finished in.
  const results: Message[] = new Array(calls.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(ctx.config.maxParallelTools, calls.length) },
    async () => {
      while (next < calls.length) {
        const index = next++;
        results[index] = await settle(calls[index] as ToolCall);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function finish(
  ctx: LoopContext,
  text: string,
  usage: Usage,
  turns: number,
  toolsUsed: string[],
): Promise<void> {
  const title = deliverableTitle(text);
  const hasTitleLine = text.trimStart().startsWith("# ");
  let noteId: string | null = null;

  const shouldWrite =
    ctx.writeDeliverable !== undefined && (ctx.writeOnlyTitledDeliverable !== true || hasTitleLine);

  if (shouldWrite && ctx.writeDeliverable !== undefined) {
    const written = await ctx.writeDeliverable({
      title,
      body: text,
      ...(ctx.revises === undefined ? {} : { revises: ctx.revises }),
    });
    noteId = written.noteId;
    await ctx.store.append(ctx.runId, {
      type: "brain_note_written",
      noteId,
      status: "draft",
      ...(ctx.revises === undefined ? {} : { revises: ctx.revises }),
    });
  }

  await ctx.store.append(ctx.runId, {
    type: "done",
    deliverable: { title, text, noteId },
    usage,
    costUsd: costOf(usage, ctx.pricing),
    toolsUsed,
    turns,
  });
}

export async function runAgentLoop(ctx: LoopContext): Promise<void> {
  const messages: Message[] = [
    { role: "system", content: ctx.systemPrompt },
    ...(ctx.priorMessages ?? []),
    { role: "user", content: ctx.prompt },
  ];

  await ctx.store.append(ctx.runId, {
    type: "started",
    agentId: ctx.agentId,
    kind: ctx.kind,
    model: { provider: ctx.adapter.id, model: ctx.model },
    modelSource: ctx.modelSource as never,
    prompt: ctx.prompt,
    parentRunId: ctx.parentRunId,
    routineId: ctx.routineId,
    systemPromptHash: ctx.systemPromptHash,
    toolNames: ctx.allowedTools.map((t) => t.tool.name),
  });

  if (ctx.pinnedIncluded.length > 0) {
    await ctx.store.append(ctx.runId, {
      type: "brain_pinned_included",
      noteIds: ctx.pinnedIncluded,
    });
  }
  if (ctx.pinnedTruncated.length > 0) {
    await ctx.store.append(ctx.runId, {
      type: "brain_pinned_truncated",
      noteIds: ctx.pinnedTruncated,
    });
  }

  // A model that cannot call tools, given to an agent that has them, fails before
  // the first request rather than silently ignoring half its job.
  if (ctx.allowedTools.length > 0 && !ctx.adapter.capabilities(ctx.model).supportsTools) {
    return fail(
      ctx,
      new RunError("TOOLS_UNSUPPORTED", { model: ctx.model, agent: ctx.agentId }),
      "",
      0,
    );
  }

  const toolsUsed = new Set<string>();
  let consecutiveErrorTurns = 0;
  let lastText = "";

  try {
    for (let turn = 1; turn <= ctx.config.maxTurns; turn++) {
      const { text, calls, stop, usage } = await completeWithRetry(ctx, messages, turn);
      lastText = text;
      messages.push(
        calls.length === 0
          ? { role: "assistant", content: text }
          : { role: "assistant", content: text, toolCalls: calls },
      );

      if (stop === "max_tokens" && calls.length === 0) {
        throw new RunError("OUTPUT_TRUNCATED", { agent: ctx.agentId });
      }
      if (calls.length === 0) {
        await finish(ctx, text, usage, turn, [...toolsUsed]);
        return;
      }

      for (const call of calls) toolsUsed.add(call.name);
      const results = await dispatchToolBatch(ctx, calls, turn);
      messages.push(...results);

      // A model looping on failing tools wastes the owner's money in silence.
      const allErrored = results.every((r) => r.role === "tool" && r.isError === true);
      consecutiveErrorTurns = allErrored ? consecutiveErrorTurns + 1 : 0;
      if (consecutiveErrorTurns >= 3) {
        throw new RunError("TOOL_FAILED", {
          agent: ctx.agentId,
          tool: calls[0]?.name ?? "a tool",
          error: "three turns in a row returned only errors",
        });
      }
    }
    throw new RunError("MAX_TURNS", { agent: ctx.agentId, turns: ctx.config.maxTurns });
  } catch (error) {
    if (ctx.signal.aborted) {
      return fail(ctx, new RunError("CANCELLED"), lastText, ctx.config.maxTurns);
    }
    return fail(ctx, error, lastText, ctx.config.maxTurns);
  }
}

async function fail(
  ctx: LoopContext,
  error: unknown,
  partialText: string,
  turns: number,
): Promise<void> {
  const runError =
    error instanceof RunError
      ? error
      : new RunError("INTERNAL", { runId: ctx.runId }, { cause: error });
  await ctx.store.append(ctx.runId, {
    type: "failed",
    error: runError.toJSON(),
    partialText: partialText.length > 0 ? partialText : null,
    turns,
  });
}

/**
 * Rebuilds the message list from a run's events, for resume and for the chat tab.
 * Only the highest attempt of each turn contributes text: the earlier ones are
 * what the model produced before a retry, and replaying them would duplicate it.
 */
export function messagesFromEvents(events: RunEvent[], systemPrompt: string): Message[] {
  const messages: Message[] = [{ role: "system", content: systemPrompt }];
  const textByTurn = new Map<number, { attempt: number; text: string }>();
  const callsByTurn = new Map<number, ToolCall[]>();
  const order: Array<{ turn: number }> = [];

  for (const event of events) {
    if (event.type === "started") {
      messages.push({ role: "user", content: event.prompt });
    } else if (event.type === "chunk") {
      const existing = textByTurn.get(event.turn);
      if (existing === undefined || event.attempt > existing.attempt) {
        textByTurn.set(event.turn, { attempt: event.attempt, text: event.text });
      } else if (event.attempt === existing.attempt) {
        existing.text += event.text;
      }
      if (!order.some((o) => o.turn === event.turn)) order.push({ turn: event.turn });
    } else if (event.type === "tool_call") {
      callsByTurn.set(event.turn, [...(callsByTurn.get(event.turn) ?? []), event.call]);
      if (!order.some((o) => o.turn === event.turn)) order.push({ turn: event.turn });
    }
  }

  const resultsByCallId = new Map<string, Extract<RunEvent, { type: "tool_result" }>>();
  for (const event of events)
    if (event.type === "tool_result") resultsByCallId.set(event.toolCallId, event);

  for (const { turn } of order) {
    const text = textByTurn.get(turn)?.text ?? "";
    const calls = callsByTurn.get(turn) ?? [];
    messages.push(
      calls.length === 0
        ? { role: "assistant", content: text }
        : { role: "assistant", content: text, toolCalls: calls },
    );
    for (const call of calls) {
      const result = resultsByCallId.get(call.id);
      if (result === undefined) continue;
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: result.name,
        content: `<tool_result name="${result.name}" trust="untrusted">\n${result.output}\n</tool_result>`,
        isError: result.isError,
      });
    }
  }
  return messages;
}
