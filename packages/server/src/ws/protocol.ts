/**
 * The wire protocol between the office and the browser.
 *
 * One connection per tab. Client messages carry a reqId the server echoes on the
 * ack or error; server pushes carry a monotonic seq so a reconnecting tab can say
 * what it last saw and be given only what it missed.
 */

import type {
  BrainGraph,
  BrainGraphEdge,
  BrainGraphNode,
  ConfigError,
  OfficeState,
  RunErrorCode,
  RunEventEnvelope,
} from "@staffroom/core";
import type { RoutineInput } from "../scheduler/routines.js";

export const PROTOCOL_VERSION = 1;

/**
 * What a schedule picker produces: the part of a routine that is about when.
 *
 * `monthly` and `weekday` were missing from the stub this replaces, so the
 * popover could not express two of the cadences a routine already supported.
 */
export interface ScheduleSpec {
  cadence: "daily" | "weekdays" | "weekly" | "monthly";
  /** "HH:MM" on the office's own clock. */
  time: string;
  weekday?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  /** 1 to 28, for a monthly routine. */
  day?: number;
  /** Shown in the routine list. Falls back to the task itself. */
  label?: string;
  /** Ask before anything leaves the machine. Defaults to yes; see RoutineSchema. */
  approvalRequired?: boolean;
}

export type ClientMessage =
  | { type: "hello"; reqId: string; protocol: 1; token: string; resumeFrom?: number }
  | {
      type: "task.create";
      reqId: string;
      department: string;
      text: string;
      /**
       * Turns this into a routine rather than running it now.
       *
       * The task bar's schedule popover sends this; the server makes the routine
       * and answers with its id, so one control does "do it" and "do it every
       * morning" without the owner learning a second concept.
       */
      schedule?: ScheduleSpec;
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
      match?: Record<string, string>;
    }
  | { type: "agent.rename"; reqId: string; agentId: string; name: string }
  | { type: "provider.set_key"; reqId: string; provider: string; key: string }
  | { type: "routine.upsert"; reqId: string; routine: RoutineInput }
  | { type: "routine.delete"; reqId: string; routineId: string }
  | { type: "routine.run_now"; reqId: string; routineId: string }
  | { type: "brain.search"; reqId: string; query: string; limit?: number }
  | { type: "brain.graph.get"; reqId: string; includeReads?: boolean }
  | { type: "runs.replay"; reqId: string; runId: string }
  | { type: "mcp.reconnect"; reqId: string; server: string }
  | { type: "mcp.oauth.begin"; reqId: string; server: string }
  | { type: "tools.assign"; reqId: string; name: string; agentIds: string[] }
  /** `app` is a DetectedEditor id, or "finder" for the file manager. */
  | { type: "note.reveal"; reqId: string; noteId: string; app?: string }
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
      /**
       * Markdown editors found on this machine, in preference order. Empty means
       * the office offers no "Open in editor" button at all — see editors.ts for
       * why an undetected editor is worse than none.
       */
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
  | { type: "brain.graph"; reqId: string; seq: number; graph: BrainGraph }
  /** One note changed on disk, with the arrows that touch it. */
  | { type: "brain.note.indexed"; seq: number; node: BrainGraphNode; edges: BrainGraphEdge[] }
  /**
   * A note is gone. `nowMissing` and `edges` are what has to be redrawn: anything
   * that linked to it is pointing at a hole now, and the picture has to say so.
   */
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

/** Messages whose handlers arrive in a later milestone. */
export const NOT_YET: ReadonlySet<ClientMessage["type"]> = new Set(["office.reload"]);

export const NOT_YET_HINT = "Not available in this version.";

/** Errors the protocol itself raises, on top of the ones core defines. */
export type ProtocolErrorCode = RunErrorCode | "APPROVAL_NOT_PENDING" | "BAD_MESSAGE";
