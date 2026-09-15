/**
 * The Runner: what the server calls when someone types a task.
 *
 * It owns the decisions the loop should not: who does the work, which model they
 * run on, what a chat turn remembers, and what "revise" revises. The loop itself
 * only knows how to take a turn.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrainIndex } from "../brain/index.js";
import { writeDeliverable } from "../brain/write.js";
import type { AgentConfig, AgentsFile } from "../config/agents.js";
import type { OfficeConfig } from "../config/config.js";
import type { Roster } from "../config/roster.js";
import { RosterWriter } from "../config/roster.js";
import { type ResolvedModel, resolveModel } from "../providers/resolve.js";
import type { Message, ProviderAdapter } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { RunError } from "./errors.js";
import type { Run, RunKind, RunStore } from "./events.js";
import { type LoopContext, type LoopRunnerConfig, runAgentLoop } from "./loop.js";
import { buildSystemPrompt, type PinnedNote } from "./prompt.js";
import { buildReviseMessages } from "./revise.js";
import { askLead, badRouting, resolveDecision } from "./routing.js";
import { newRunId } from "./store.js";

/** How many previous turns a chat remembers. */
const CHAT_HISTORY_TURNS = 20;

export interface RunnerDeps {
  store: RunStore;
  tools: ToolRegistry;
  brain: BrainIndex;
  roster: Roster;
  agentsFile: AgentsFile;
  config: OfficeConfig;
  providers: Map<string, ProviderAdapter>;
  brainDir: string;
  officeDir?: string;
  mode?: "live" | "demo";
}

export interface SubmitTaskInput {
  department: string;
  prompt: string;
  /** Skips routing. */
  agentId?: string;
  modelOverride?: string;
  source?: "taskbar" | "routine";
  routineId?: string;
}

export class Runner {
  private readonly deps: RunnerDeps;
  private readonly running = new Map<string, AbortController>();

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  private loopConfig(): LoopRunnerConfig {
    const r = this.deps.config.runner;
    return {
      maxTurns: r.max_turns,
      maxParallelTools: r.max_parallel_tools,
      maxOutputTokens: r.max_output_tokens,
      toolOutputMaxChars: r.tool_output_max_chars,
      ...(r.temperature === undefined ? {} : { temperature: r.temperature }),
      retries: { attempts: r.retries.attempts, baseMs: r.retries.base_ms, maxMs: r.retries.max_ms },
    };
  }

  private adapterFor(resolved: ResolvedModel): ProviderAdapter {
    const adapter = this.deps.providers.get(resolved.provider);
    if (adapter === undefined) {
      throw new RunError("PROVIDER_NOT_CONFIGURED", {
        agent: "this office",
        provider: resolved.provider,
      });
    }
    return adapter;
  }

  private resolve(agent: AgentConfig, override?: string): ResolvedModel {
    return resolveModel({
      agent,
      agentsFile: this.deps.agentsFile,
      config: this.deps.config,
      // The adapters that exist are the authority, not the config block: demo mode
      // injects one without any providers configured at all.
      available: this.deps.providers.keys(),
      defaultModelOf: (provider) => this.deps.providers.get(provider)?.defaultModel(),
      ...(override === undefined ? {} : { override }),
    });
  }

  private pinnedNotes(): PinnedNote[] {
    return this.deps.brain
      .pinned()
      .map((ref) => this.deps.brain.read_(ref.id))
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        frontMatter: {
          title: n.title,
          created: n.createdAt ?? "",
          written_by: "owner",
        } as PinnedNote["frontMatter"],
      }));
  }

  private buildContext(args: {
    run: Run;
    agent: AgentConfig;
    resolved: ResolvedModel;
    prompt: string;
    controller: AbortController;
    priorMessages?: Message[];
    revises?: string;
    writeOnlyTitled?: boolean;
    withTools?: boolean;
    withBrain?: boolean;
  }): LoopContext {
    const { run, agent, resolved, prompt, controller } = args;
    const department = this.deps.roster.department(agent.department);
    const allowedTools =
      args.withTools === false ? [] : this.deps.tools.forAgent(agent, this.deps.config);

    const built = buildSystemPrompt({
      agent,
      department: department?.label ?? agent.department,
      office: {
        name: this.deps.roster.officeName,
        ...(this.deps.mode === undefined ? {} : { mode: this.deps.mode }),
      },
      pinnedNotes: args.withBrain === false ? [] : this.pinnedNotes(),
      tools: allowedTools,
      pinnedTokenBudget: this.deps.config.brain.pinned_token_budget,
    });

    return {
      runId: run.id,
      kind: run.kind,
      agentId: agent.id,
      department: agent.department,
      adapter: this.adapterFor(resolved),
      model: resolved.model,
      modelSource: resolved.source,
      pricing: this.adapterFor(resolved).pricing(resolved.model),
      prompt,
      systemPrompt: built.text,
      systemPromptHash: built.hash,
      pinnedIncluded: built.pinnedIncluded,
      pinnedTruncated: built.pinnedTruncated,
      tools: this.deps.tools,
      allowedTools,
      store: this.deps.store,
      brain: this.deps.brain.reader(),
      signal: controller.signal,
      config: this.loopConfig(),
      parentRunId: run.parentRunId,
      routineId: run.routineId,
      ...(args.priorMessages === undefined ? {} : { priorMessages: args.priorMessages }),
      ...(args.revises === undefined ? {} : { revises: args.revises }),
      ...(args.writeOnlyTitled === undefined
        ? {}
        : { writeOnlyTitledDeliverable: args.writeOnlyTitled }),
      writeDeliverable: async ({ title, body, revises }) => {
        const written = writeDeliverable(this.deps.brainDir, {
          title,
          body,
          department: agent.department,
          agentId: agent.id,
          runId: run.id,
          ...(run.routineId === null ? {} : { task: `routine:${run.routineId}` }),
          model: `${resolved.provider}/${resolved.model}`,
          ...(revises === undefined ? {} : { revises }),
        });
        return { noteId: written.id };
      },
    };
  }

  private async createRun(args: {
    kind: RunKind;
    agent: AgentConfig;
    resolved: ResolvedModel;
    prompt: string;
    parentRunId?: string | null;
    routineId?: string | null;
  }): Promise<Run> {
    return this.deps.store.create({
      id: newRunId(),
      kind: args.kind,
      agentId: args.agent.id,
      department: args.agent.department,
      model: { provider: args.resolved.provider, model: args.resolved.model },
      prompt: args.prompt,
      parentRunId: args.parentRunId ?? null,
      routineId: args.routineId ?? null,
      sample: false,
      createdAt: Date.now(),
    });
  }

  /** Runs the loop in the background and tracks it so cancel() can reach it. */
  private start(ctx: LoopContext, controller: AbortController): Promise<void> {
    this.running.set(ctx.runId, controller);
    return runAgentLoop(ctx).finally(() => this.running.delete(ctx.runId));
  }

  async submitTask(
    input: SubmitTaskInput,
  ): Promise<{ routeRunId: string | null; runId: string; finished: Promise<void> }> {
    const { department, prompt } = input;
    const members = this.deps.roster.department(department)?.agents ?? [];
    if (members.length === 0) {
      throw new RunError("BAD_ROUTING", { lead: department, agent: "nobody" });
    }

    const routineId = input.routineId ?? null;
    const workerKind: RunKind = input.source === "routine" ? "routine" : "task";

    // Named agent, or a department of one: no routing to do.
    const direct = input.agentId !== undefined ? this.deps.roster.agent(input.agentId) : undefined;
    if (direct !== undefined || members.length === 1) {
      const agent = direct ?? (members[0] as AgentConfig);
      const resolved = this.resolve(agent, input.modelOverride);
      const run = await this.createRun({ kind: workerKind, agent, resolved, prompt, routineId });
      const controller = new AbortController();
      const ctx = this.buildContext({ run, agent, resolved, prompt, controller });
      return { routeRunId: null, runId: run.id, finished: this.start(ctx, controller) };
    }

    const lead = this.deps.roster.leadFor(department) as AgentConfig;
    const team = this.deps.roster.workersIn(department);
    const leadModel = this.resolve(lead, input.modelOverride);
    const routeRun = await this.createRun({
      kind: "route",
      agent: lead,
      resolved: leadModel,
      prompt,
      routineId,
    });
    const controller = new AbortController();
    this.running.set(routeRun.id, controller);

    // The lead's prompt has identity, owner instructions and the rules, and
    // nothing else: no brain, no tools. It is picking a person, not doing work.
    const leadCtx = this.buildContext({
      run: routeRun,
      agent: lead,
      resolved: leadModel,
      prompt,
      controller,
      withTools: false,
      withBrain: false,
    });

    await this.deps.store.append(routeRun.id, {
      type: "started",
      agentId: lead.id,
      kind: "route",
      model: { provider: leadModel.provider, model: leadModel.model },
      modelSource: leadModel.source,
      prompt,
      parentRunId: null,
      routineId,
      systemPromptHash: leadCtx.systemPromptHash,
      toolNames: [],
    });

    let decision = resolveDecision(
      await askLead({
        adapter: leadCtx.adapter,
        model: leadModel.model,
        systemPrompt: leadCtx.systemPrompt,
        task: prompt,
        team,
        maxOutputTokens: this.deps.config.runner.max_output_tokens,
        signal: controller.signal,
      }).catch(() => undefined),
      team,
      this.deps.roster,
    );

    // An unusable answer is not a dead end: the work goes to the first team member
    // with the owner's own words as the brief, and the route run records why.
    if (decision === undefined) {
      const fallback = team[0] as AgentConfig;
      await this.deps.store.append(routeRun.id, {
        type: "failed",
        error: badRouting(lead, fallback).toJSON(),
        partialText: null,
        turns: 1,
      });
      decision = { chosen: fallback, brief: prompt };
    }

    if (decision.name !== undefined) this.nameAgent(decision.chosen.id, decision.name, lead.id);

    const worker = decision.chosen;
    const workerModel = this.resolve(worker, input.modelOverride);
    const workerRun = await this.createRun({
      kind: workerKind,
      agent: worker,
      resolved: workerModel,
      prompt: decision.brief,
      parentRunId: routeRun.id,
      routineId,
    });

    await this.deps.store.append(routeRun.id, {
      type: "routed",
      toAgentId: worker.id,
      childRunId: workerRun.id,
      brief: decision.brief,
    });
    // A route run hands over and stops. It never calls finish() and never writes a note.
    await this.deps.store.append(routeRun.id, {
      type: "done",
      deliverable: {
        title: `Handed to ${worker.name ?? worker.id}`,
        text: decision.brief,
        noteId: null,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: null,
      toolsUsed: [],
      turns: 1,
    });
    this.running.delete(routeRun.id);

    const workerController = new AbortController();
    const workerCtx = this.buildContext({
      run: workerRun,
      agent: worker,
      resolved: workerModel,
      prompt: decision.brief,
      controller: workerController,
    });
    return {
      routeRunId: routeRun.id,
      runId: workerRun.id,
      finished: this.start(workerCtx, workerController),
    };
  }

  /** Writes the name into agents.yaml, keeping the owner's comments. */
  private nameAgent(agentId: string, name: string, namedBy: string): void {
    if (this.deps.officeDir === undefined) return;
    try {
      const path = join(this.deps.officeDir, "agents.yaml");
      const writer = new RosterWriter(readFileSync(path, "utf8"));
      if (writer.setName(agentId, name, namedBy, new Date().toISOString().slice(0, 10))) {
        writeFileSync(path, writer.toString(), "utf8");
      }
    } catch {
      // A name is a nicety. Failing to write it must not fail the task.
    }
  }

  async chat(input: {
    agentId: string;
    text: string;
    modelOverride?: string;
  }): Promise<{ runId: string; finished: Promise<void> }> {
    const agent = this.deps.roster.agent(input.agentId);
    if (agent === undefined)
      throw new RunError("BAD_ROUTING", { lead: "the office", agent: input.agentId });

    const resolved = this.resolve(agent, input.modelOverride);
    const run = await this.createRun({ kind: "chat", agent, resolved, prompt: input.text });
    const controller = new AbortController();
    const ctx = this.buildContext({
      run,
      agent,
      resolved,
      prompt: input.text,
      controller,
      priorMessages: await this.chatHistory(input.agentId),
      // A chat reply is only a deliverable when it looks like one.
      writeOnlyTitled: true,
    });
    return { runId: run.id, finished: this.start(ctx, controller) };
  }

  /** The last turns of this agent's previous chats, rebuilt from their events. */
  private async chatHistory(agentId: string): Promise<Message[]> {
    const runs = await this.deps.store.list({ agentId, kind: ["chat"], limit: CHAT_HISTORY_TURNS });
    const messages: Message[] = [];
    for (const run of [...runs].reverse()) {
      let reply = "";
      for await (const envelope of this.deps.store.events(run.id)) {
        if (envelope.event.type === "chunk") reply += envelope.event.text;
      }
      messages.push({ role: "user", content: run.prompt });
      if (reply.length > 0) messages.push({ role: "assistant", content: reply });
    }
    return messages;
  }

  async revise(input: {
    agentId: string;
    instructions: string;
  }): Promise<{ runId: string; finished: Promise<void> }> {
    const agent = this.deps.roster.agent(input.agentId);
    if (agent === undefined)
      throw new RunError("BAD_ROUTING", { lead: "the office", agent: input.agentId });

    const previous = await this.deps.store.lastDeliverable(input.agentId);
    if (previous === null)
      throw new RunError("NOTHING_TO_REVISE", { agent: agent.name ?? agent.id });

    const { messages, prompt } = buildReviseMessages(previous, input.instructions);
    const resolved = this.resolve(agent);
    const run = await this.createRun({ kind: "revise", agent, resolved, prompt });
    const controller = new AbortController();
    const ctx = this.buildContext({
      run,
      agent,
      resolved,
      prompt,
      controller,
      priorMessages: messages,
      ...(previous.deliverable.noteId === null ? {} : { revises: previous.deliverable.noteId }),
    });
    return { runId: run.id, finished: this.start(ctx, controller) };
  }

  cancel(runId: string): boolean {
    const controller = this.running.get(runId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  activeRunIds(): string[] {
    return [...this.running.keys()];
  }
}
