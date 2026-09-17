/**
 * The message types, mirrored from the server.
 *
 * Duplicated rather than imported because the web package must not depend on the
 * server package: the browser bundle would drag in node built-ins. The shapes the
 * office actually renders come from @staffroom/core as types.
 */
import type {
  BrainGraph,
  BrainGraphEdge,
  BrainGraphNode,
  ConfigError,
  OfficeState,
  RunEventEnvelope,
} from "@staffroom/core";

export type ClientMessage =
  | { type: "hello"; reqId: string; protocol: 1; token: string; resumeFrom?: number }
  | {
      type: "task.create";
      reqId: string;
      department: string;
      text: string;
      /** Makes this a routine rather than something that happens now. */
      schedule?: {
        cadence: "daily" | "weekdays" | "weekly" | "monthly";
        time: string;
        weekday?: string;
        day?: number;
        label?: string;
      };
      agentId?: string;
      modelOverride?: string;
    }
  | { type: "task.cancel"; reqId: string; runId: string }
  | { type: "chat.send"; reqId: string; agentId: string; text: string; modelOverride?: string }
  | {
      type: "approval.decide";
      reqId: string;
      approvalId: string;
      decision: "approve" | "approve_always" | "deny";
      note?: string;
      /** What "always" should be limited to. Required for approve_always. */
      match?: Record<string, string>;
    }
  | { type: "agent.rename"; reqId: string; agentId: string; name: string }
  | { type: "brain.search"; reqId: string; query: string; limit?: number }
  | { type: "brain.graph.get"; reqId: string; includeReads?: boolean }
  /** A whole routine, or a change to one; the server merges when the id exists. */
  | { type: "routine.upsert"; reqId: string; routine: Record<string, unknown> }
  | { type: "routine.delete"; reqId: string; routineId: string }
  | { type: "routine.run_now"; reqId: string; routineId: string }
  | { type: "runs.replay"; reqId: string; runId: string }
  | { type: "note.reveal"; reqId: string; noteId: string; app?: string }
  | { type: "provider.set_key"; reqId: string; provider: string; key: string }
  | {
      type: "agent.create";
      reqId: string;
      agent: { id: string; department: string; role: string; does: string; name?: string };
    }
  | { type: "agent.remove"; reqId: string; agentId: string }
  | {
      type: "agent.update";
      reqId: string;
      agentId: string;
      fields: { role?: string; does?: string; department?: string; model?: string | null };
    }
  | { type: "department.create"; reqId: string; id: string; label: string }
  | { type: "department.rename"; reqId: string; id: string; label: string }
  | { type: "department.remove"; reqId: string; id: string }
  | { type: "mcp.reconnect"; reqId: string; server: string }
  | { type: "mcp.oauth.begin"; reqId: string; server: string }
  | { type: "tools.assign"; reqId: string; name: string; agentIds: string[] }
  | { type: "demo.speed"; reqId: string; factor: 1 | 2 | 4 }
  /** SR-066: yes or no to the template's own notes and runs. */
  | { type: "demo.samples"; reqId: string; remove: boolean }
  /** SR-067: the same checks `npx staffroom doctor` runs. */
  | { type: "doctor.run"; reqId: string }
  | { type: "approvals.revoke"; reqId: string; key: string }
  | { type: "models.list"; reqId: string }
  | { type: "agents.set_default_model"; reqId: string; model: string }
  | { type: "ping"; reqId: string };

/**
 * One doctor check, as the table shows it.
 *
 * Declared here rather than imported from the server: the browser talks to the
 * office over a socket and does not depend on the server package, so the shape
 * that crosses the wire is written down on both sides.
 */
export interface DoctorCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  message: string;
  hint?: string;
  fixed?: boolean;
}

export type ServerMessage =
  | {
      type: "welcome";
      reqId: string;
      seq: number;
      protocol: 1;
      version: string;
      mode: "live" | "demo";
      platform: "mac" | "windows" | "linux";
      /** Markdown editors on this machine. Empty means no "Open in editor". */
      editors: { id: string; label: string }[];
      resumed: boolean;
      state: OfficeState;
    }
  | { type: "ack"; reqId: string; seq: number; ok: true; result?: unknown }
  | { type: "error"; reqId?: string; seq: number; code: string; message: string; hint: string }
  | { type: "state"; seq: number; state: OfficeState }
  | { type: "event"; seq: number; event: RunEventEnvelope }
  | {
      type: "replay";
      reqId: string;
      seq: number;
      runId: string;
      events: RunEventEnvelope[];
      done: boolean;
    }
  | { type: "config.error"; seq: number; errors: ConfigError[] }
  | { type: "config.reloaded"; seq: number; file: string }
  | {
      type: "tools.reloaded";
      seq: number;
      file: string;
      ok: boolean;
      message?: string;
      /** Where it broke, when the compiler said. 1-based. */
      line?: number;
      tools?: string[];
      /** The tool this file defines. */
      name?: string;
      /** Its author left `scope` out, so it will ask about every call. */
      warning?: "no_scope";
      /** Nobody may use it yet. */
      unassigned?: boolean;
      /** Everyone who could be given it. */
      agents?: { id: string; name: string }[];
    }
  | { type: "brain.results"; reqId: string; seq: number; hits: unknown[] }
  | { type: "brain.graph"; reqId: string; seq: number; graph: BrainGraph }
  | { type: "doctor.result"; reqId: string; seq: number; checks: DoctorCheck[]; ok: boolean }
  | {
      type: "models.result";
      reqId: string;
      seq: number;
      providers: { id: string; models: { id: string; created?: string }[]; error?: string }[];
    }
  | { type: "brain.note.indexed"; seq: number; node: BrainGraphNode; edges: BrainGraphEdge[] }
  | {
      type: "brain.note.removed";
      seq: number;
      noteId: string;
      nowMissing?: BrainGraphNode;
      edges: BrainGraphEdge[];
    }
  | {
      type: "brain.warning";
      seq: number;
      scope: "note" | "index" | "pinned";
      noteId?: string;
      reason: string;
      /** Owner-facing, already a sentence. */
      message: string;
    }
  | { type: "pong"; reqId: string; seq: number };
