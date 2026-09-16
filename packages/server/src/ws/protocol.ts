/**
 * The wire protocol between the office and the browser.
 *
 * One connection per tab. Client messages carry a reqId the server echoes on the
 * ack or error; server pushes carry a monotonic seq so a reconnecting tab can say
 * what it last saw and be given only what it missed.
 */
import type { ConfigError, OfficeState, RunErrorCode, RunEventEnvelope } from "@staffroom/core";

export const PROTOCOL_VERSION = 1;

export interface ScheduleSpec {
  cadence: "daily" | "weekdays" | "weekly";
  at: string;
  approvalRequired?: boolean;
}

export type ClientMessage =
  | { type: "hello"; reqId: string; protocol: 1; token: string; resumeFrom?: number }
  | {
      type: "task.create";
      reqId: string;
      department: string;
      text: string;
      agentId?: string;
      modelOverride?: string;
      schedule?: ScheduleSpec;
    }
  | { type: "task.cancel"; reqId: string; runId: string }
  | { type: "chat.send"; reqId: string; agentId: string; text: string; modelOverride?: string }
  | {
      type: "approval.decide";
      reqId: string;
      approvalId: string;
      decision: "approve" | "approve_always" | "deny";
      note?: string;
      match?: Record<string, string>;
    }
  | { type: "agent.rename"; reqId: string; agentId: string; name: string }
  | { type: "provider.set_key"; reqId: string; provider: string; key: string }
  | { type: "routine.upsert"; reqId: string; routine: unknown }
  | { type: "routine.delete"; reqId: string; routineId: string }
  | { type: "routine.run_now"; reqId: string; routineId: string }
  | { type: "brain.search"; reqId: string; query: string; limit?: number }
  | { type: "brain.graph.get"; reqId: string; includeReads?: boolean }
  | { type: "runs.replay"; reqId: string; runId: string }
  | { type: "mcp.reconnect"; reqId: string; server: string }
  | { type: "mcp.oauth.begin"; reqId: string; server: string }
  | { type: "tools.assign"; reqId: string; name: string; agentIds: string[] }
  | { type: "note.reveal"; reqId: string; noteId: string }
  | { type: "demo.speed"; reqId: string; factor: 1 | 2 | 4 }
  | { type: "office.reload"; reqId: string }
  | { type: "ping"; reqId: string };

export type ServerMessage =
  | {
      type: "welcome";
      reqId: string;
      seq: number;
      protocol: 1;
      version: string;
      mode: "live" | "demo";
      /** So the browser can say "Show in Finder" or "Show in Explorer" correctly. */
      platform: "mac" | "windows" | "linux";
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
  | {
      type: "config.reloaded";
      seq: number;
      file: "agents.yaml" | "config.yaml" | "routines.yaml" | "approvals.yaml" | ".env";
    }
  /**
   * One tool file changed, and what the owner needs to know about it.
   *
   * Three cards in `office-ui.md` come out of this one message: it would not
   * load (`ok: false` with `line`), it has no scope so it will ask every time
   * (`warning: "no_scope"`), and nobody may use it yet (`unassigned`, with
   * everyone who could be given it). A file can be more than one of those at
   * once, which is why they are fields rather than three message types.
   */
  | {
      type: "tools.reloaded";
      seq: number;
      file: string;
      name?: string;
      ok: boolean;
      message?: string;
      line?: number;
      tools?: string[];
      warning?: "no_scope";
      unassigned?: boolean;
      agents?: { id: string; name: string }[];
    }
  | { type: "brain.results"; reqId: string; seq: number; hits: unknown[] }
  | { type: "brain.warning"; seq: number; scope: "note"; id: string; reason: string }
  | { type: "pong"; reqId: string; seq: number };

/** Messages whose handlers arrive in a later milestone. */
export const NOT_YET: ReadonlySet<ClientMessage["type"]> = new Set([
  "routine.upsert",
  "routine.delete",
  "routine.run_now",
  "brain.graph.get",
  "office.reload",
]);

export const NOT_YET_HINT = "Not available in this version.";

/** Errors the protocol itself raises, on top of the ones core defines. */
export type ProtocolErrorCode = RunErrorCode | "APPROVAL_NOT_PENDING" | "BAD_MESSAGE";
