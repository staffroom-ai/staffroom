/**
 * What the office looks like right now.
 *
 * The web package is a render layer over this one object. It holds no business
 * state of its own, which is what lets someone swap the 3D scene for a 2D canvas
 * without touching anything else. The server sends a whole snapshot rather than a
 * patch: snapshots cannot drift, and at this size they are cheap.
 */

import type { ModelStatus } from "./providers/resolve.js";
import type { ApprovalPreview } from "./shared/types.js";

export type AgentStatus = "idle" | "working" | "waiting_approval" | "error";

export interface Department {
  id: string;
  name: string;
  leadAgentId: string | null;
  /** Position in the office, by first appearance in agents.yaml. */
  pod: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface Agent {
  id: string;
  name: string | null;
  role: string;
  does: string;
  departmentId: string;
  /** Desk within the pod, assigned by the server. */
  seat: number;
  model: string;
  modelSource: "agent" | "office_default" | "first_provider" | "override";
  modelStatus: ModelStatus;
  /** True when this agent's model runs on this machine. */
  local: boolean;
  /** Connector ids this agent may use. Brain tools are omitted: everyone has them. */
  tools: string[];
  status: AgentStatus;
  currentRunId: string | null;
  /** First 140 characters of what they are working on. */
  currentTask: string | null;
  lastActiveAt: string | null;
}

export interface Connector {
  id: string;
  kind: "mcp" | "custom" | "builtin";
  label: string;
  health: "ok" | "starting" | "auth_required" | "down" | "load_failed" | "denied" | "grey";
  /** Owner-facing, already redacted. */
  message: string | null;
  toolCount: number;
  departments: string[] | "all";
  lastUsedAt: string | null;
  /** Calls in the last 60 seconds, for the pulse animation. */
  pulse: number;
}

export interface ActiveRun {
  id: string;
  kind: "task" | "route" | "chat" | "revise" | "routine";
  task: string;
  departmentId: string;
  /** Null while the lead is still choosing. */
  agentId: string | null;
  status: "queued" | "running" | "waiting_approval";
  startedAt: string;
  modelOverride: string | null;
  routineId: string | null;
}

export interface PendingApprovalView {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  tool: { name: string; source: "builtin" | "custom" | "mcp"; scope: "write" };
  /** What the tool was called with. The preview's body already shows it in full. */
  input: unknown;
  preview: ApprovalPreview;
  requestedAt: string;
  expiresAt: string;
}

export interface RoutineView {
  id: string;
  label: string;
  cadence: string;
  at: string;
  nextRunAt: string | null;
  enabled: boolean;
}

export interface DeliverableSummary {
  noteId: string;
  title: string;
  agentId: string;
  agentName: string | null;
  departmentId: string;
  createdAt: string;
  runId: string;
}

/**
 * A permission the owner already gave, as the list shows it.
 *
 * `lastUsed` is the field that makes the list worth reading. "Allowed six weeks
 * ago, never used" is a row to take back; "used an hour ago" is the office
 * doing its job. A list of grants with no usage is a list nobody can act on.
 */
export interface WhitelistRow {
  /** Identity, for revoking exactly this row and no other. */
  key: string;
  agentId: string;
  agentName: string | null;
  tool: string;
  /** The field patterns this permission is pinned to. Empty means any input. */
  match: Record<string, string>;
  granted: string;
  expires: string | null;
  lastUsed: string | null;
  /** The tool changed since this was granted, so the owner is asked again. */
  suspended: boolean;
}

export interface OfficeState {
  version: 1;
  mode: "live" | "demo";
  officeName: string;
  timezone: string;
  /** ISO 8601, server time, resent every 30 seconds. */
  clock: string;
  defaultModel: string | null;
  departments: Department[];
  agents: Agent[];
  connectors: Connector[];
  /** Running or waiting. Finished runs are not here. */
  runs: ActiveRun[];
  approvals: PendingApprovalView[];
  routines: RoutineView[];
  /** Last five, newest first. */
  latestDeliverables: DeliverableSummary[];
  /** SR-067: permissions already given, newest first. */
  whitelist: WhitelistRow[];
  /**
   * The one-off question about the template's own notes and runs, or null once
   * it has been answered. Full sentence rather than a flag, because the office
   * it names is the part that makes it answerable.
   */
  sampleQuestion: string | null;
}
