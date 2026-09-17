/**
 * Building the snapshot the office renders from.
 *
 * Whole snapshots rather than patches: they cannot drift out of step with the
 * truth, and at 35 agents the whole thing is a few kilobytes. Coalesced at 250 ms
 * so a burst of events produces one push rather than twenty.
 */

import type {
  ActiveRun,
  Agent,
  Connector,
  DeliverableSummary,
  DepartmentView,
  Office,
  OfficeState,
  PendingApprovalView,
  RoutineView,
  Run,
} from "@staffroom/core";
import {
  type McpState,
  modelStatusFor,
  redactSecrets,
  resolveModel,
  webSearchStatus,
} from "@staffroom/core";
import type { RoutineStatus } from "../scheduler/scheduler.js";

/** Brain tools are omitted from an agent's list: everyone has them. */
const IMPLIED = new Set(["brain_search", "brain_read", "brain_write", "brain_list"]);

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

export interface BuildStateOptions {
  office: Office;
  /** Runs currently in flight, from the store. */
  activeRuns: Run[];
  approvals: PendingApprovalView[];
  deliverables: DeliverableSummary[];
  /** SR-066: set only while the sample-content question is still open. */
  sampleQuestion?: string | undefined;
  now?: Date;
  /** Absent in an office that is not running routines; the list is then empty. */
  scheduler?: { status(): RoutineStatus[] } | undefined;
}

/**
 * What a connection's state means to somebody looking at the connector strip.
 *
 * Deliberately a table rather than a chain of conditions: these are the only six
 * states a server can be in, and a reader should be able to see all six at once.
 */
const MCP_HEALTH: Record<McpState, Connector["health"]> = {
  connecting: "starting",
  ready: "ok",
  unavailable: "down",
  denied: "denied",
  needs_auth: "auth_required",
  stopped: "grey",
};

export function buildOfficeState(options: BuildStateOptions): OfficeState {
  const { office, activeRuns, approvals, deliverables } = options;
  const now = options.now ?? new Date();

  // SR-063: what the office does without being asked, and when it is next due.
  // A paused routine has no next time, which is the honest answer rather than a
  // date that is not going to happen.
  const routines: RoutineView[] = (options.scheduler?.status() ?? []).map(
    ({ routine, nextRunAt }) => ({
      id: routine.id,
      label: routine.label,
      cadence: routine.cadence,
      at: routine.time,
      nextRunAt: nextRunAt === undefined ? null : new Date(nextRunAt).toISOString(),
      enabled: !routine.paused,
    }),
  );

  const departments: DepartmentView[] = office.roster.departments.map((d) => ({
    id: d.id,
    name: d.label,
    leadAgentId: office.roster.leadFor(d.id)?.id ?? null,
    pod: d.pod as DepartmentView["pod"],
  }));

  const runByAgent = new Map<string, Run>();
  for (const run of activeRuns) if (!runByAgent.has(run.agentId)) runByAgent.set(run.agentId, run);
  const waitingAgents = new Set(approvals.map((a) => a.agentId));

  const agents: Agent[] = office.roster.agents.map((agent) => {
    const seat = office.roster.seatOf(agent.id);
    const current = runByAgent.get(agent.id);

    let model = "";
    let modelSource: Agent["modelSource"] = "office_default";
    try {
      const resolved = resolveModel({
        agent,
        agentsFile: office.agentsFile,
        config: office.config,
        available: office.providers.keys(),
      });
      model = `${resolved.provider}/${resolved.model}`;
      modelSource = resolved.source;
    } catch {
      // An agent whose model cannot resolve still appears; its badge says why.
      model = office.agentsFile.default_model ?? "";
    }

    const status: Agent["status"] = waitingAgents.has(agent.id)
      ? "waiting_approval"
      : current !== undefined
        ? "working"
        : "idle";

    return {
      id: agent.id,
      name: agent.name ?? null,
      role: agent.role,
      does: agent.does,
      departmentId: agent.department,
      seat: seat?.seat ?? 0,
      model,
      modelSource,
      modelStatus: modelStatusFor({
        agent,
        agentsFile: office.agentsFile,
        config: office.config,
        available: office.providers.keys(),
      }),
      local: office.providers.get(model.split("/")[0] ?? "")?.kind === "ollama",
      tools: office.tools
        .forAgent(agent, office.config)
        .map((t) => t.tool.name)
        .filter((name) => !IMPLIED.has(name)),
      status,
      currentRunId: current?.id ?? null,
      currentTask: current === undefined ? null : current.prompt.slice(0, 140),
      lastActiveAt: iso(current?.createdAt ?? null),
    };
  });

  // An MCP server is one connector, not one per tool it happens to expose. Its
  // health is the connection's, so a server that is down reads as down even
  // though the tools it last offered are no longer registered at all.
  const mcpConnectors: Connector[] = office.mcp.status().map((status) => ({
    id: status.server,
    kind: "mcp" as const,
    label: status.server,
    health: MCP_HEALTH[status.state],
    // Through redaction: a connection failure can quote a URL with a token in it.
    message: status.detail === undefined ? null : redactSecrets(status.detail),
    toolCount: status.toolCount,
    departments: office.config.mcp.departments[status.server] ?? "all",
    lastUsedAt: null,
    pulse: 0,
  }));

  const connectors: Connector[] = office.tools
    .list()
    .filter(({ tool }) => !IMPLIED.has(tool.name))
    // MCP tools are represented by their server above.
    .filter(({ tool }) => tool.source.kind !== "mcp")
    .map(({ tool }) => {
      const kind = tool.source.kind;

      // SR-059: web_search is the one built-in that talks to somebody else, so
      // it is the one that can be broken while the office is fine. Grey with no
      // backend, red once a call has actually failed.
      const search = tool.name === "web_search" ? webSearchStatus(office.config) : undefined;
      const health: Connector["health"] =
        search === undefined
          ? "ok"
          : search.state === "unconfigured"
            ? "grey"
            : search.state === "down"
              ? "down"
              : "ok";

      return {
        id: tool.name,
        kind,
        label: tool.name,
        health,
        message: search?.message === undefined ? null : redactSecrets(search.message),
        toolCount: 1,
        departments: tool.departments ?? "all",
        lastUsedAt: null,
        pulse: 0,
      } satisfies Connector;
    });

  const runs: ActiveRun[] = activeRuns.map((run) => ({
    id: run.id,
    kind: run.kind,
    // The run's own name when it has one — a catch-up says so — and otherwise
    // what it was asked to do, which is what it has always shown.
    task: (run.label ?? run.prompt).slice(0, 140),
    departmentId: run.department,
    agentId: run.agentId,
    status: run.status as ActiveRun["status"],
    startedAt: new Date(run.createdAt).toISOString(),
    modelOverride: null,
    routineId: run.routineId,
  }));

  return {
    version: 1,
    mode: office.mode,
    officeName: office.roster.officeName,
    timezone: office.roster.timezone,
    clock: now.toISOString(),
    defaultModel: office.agentsFile.default_model ?? null,
    departments,
    agents,
    connectors: [...mcpConnectors, ...connectors],
    runs,
    approvals,
    routines,
    latestDeliverables: deliverables,
    sampleQuestion: options.sampleQuestion ?? null,
  };
}

/**
 * Reads everything the snapshot needs out of the store.
 */
export async function collectState(
  office: Office,
  now?: Date,
  scheduler?: { status(): RoutineStatus[] },
  sampleQuestion?: string | null,
): Promise<OfficeState> {
  const activeRuns = await office.store.list({
    status: ["queued", "running", "waiting_approval"],
    limit: 50,
  });

  const pending = await office.store.pendingApprovals();
  const approvals: PendingApprovalView[] = pending.map((a) => {
    const run = activeRuns.find((r) => r.id === a.runId);
    const agentId = run?.agentId ?? "";
    return {
      id: a.approvalId,
      runId: a.runId,
      agentId,
      agentName: office.roster.agent(agentId)?.name ?? agentId,
      tool: { name: a.tool.name, source: a.tool.source.kind, scope: "write" },
      input: a.input,
      preview: a.preview,
      requestedAt: new Date(a.requestedAt).toISOString(),
      expiresAt: new Date(a.expiresAt).toISOString(),
    };
  });

  const finished = await office.store.list({ status: ["done"], limit: 25 });
  const deliverables: DeliverableSummary[] = [];
  for (const run of finished) {
    if (deliverables.length >= 5) break;
    for await (const envelope of office.store.events(run.id)) {
      if (envelope.event.type !== "done") continue;
      const noteId = envelope.event.deliverable.noteId;
      if (noteId === null) continue;
      deliverables.push({
        noteId,
        title: envelope.event.deliverable.title,
        agentId: run.agentId,
        agentName: office.roster.agent(run.agentId)?.name ?? null,
        departmentId: run.department,
        createdAt: new Date(run.finishedAt ?? run.createdAt).toISOString(),
        runId: run.id,
      });
    }
  }

  return buildOfficeState({
    office,
    activeRuns,
    approvals,
    deliverables,
    ...(now === undefined ? {} : { now }),
    ...(scheduler === undefined ? {} : { scheduler }),
    ...(sampleQuestion === undefined || sampleQuestion === null ? {} : { sampleQuestion }),
  });
}
