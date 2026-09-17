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
  ModelInfo,
  OfficeState,
  RunErrorCode,
  RunEventEnvelope,
} from "@staffroom/core";
import type { DoctorCheck } from "../doctor/index.js";
import type { RoutineInput } from "../scheduler/routines.js";

export const PROTOCOL_VERSION = 1;

/** A change to a routine that already exists. The id says which. */
export type RoutinePatch = { id: string } & Partial<RoutineInput>;

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
  /**
   * A whole routine, or a change to one that is already there.
   *
   * Merged on the server when the id exists, so a Pause can be `{ id, paused }`:
   * the browser is never sent a routine's task or its agent, so it cannot send
   * them back.
   */
  | { type: "routine.upsert"; reqId: string; routine: RoutineInput | RoutinePatch }
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
  /**
   * SR-066: the answer to the sample-content question.
   *
   * `remove: false` is a real answer and is recorded like any other. It is what
   * stops the office asking again, which is the difference between somebody
   * choosing to keep the sample office and somebody being nagged about it.
   */
  | { type: "demo.samples"; reqId: string; remove: boolean }
  /**
   * SR-067: run the same checks `npx staffroom doctor` runs.
   *
   * No `fix` field. Doctor's `--fix` writes to the owner's files, and a button
   * in a browser tab is the wrong place to offer that without saying exactly
   * what it would change; the terminal command already asks for it explicitly.
   */
  | { type: "doctor.run"; reqId: string }
  /** SR-067: take back one permission, by the key the list showed. */
  | { type: "approvals.revoke"; reqId: string; key: string }
  /** SR-067: what each configured provider says it can run today. */
  | { type: "models.list"; reqId: string }
  | { type: "agents.set_default_model"; reqId: string; model: string }
  /*
   * Hiring, editing and letting go, from Settings.
   *
   * Every one of these ends in a document-mode write to agents.yaml and a
   * re-read into the running office, so the room changes while you watch. The
   * file stays the source of truth: anything done here could have been done by
   * editing it, which is the point of the office being a folder.
   */
  | {
      type: "agent.create";
      reqId: string;
      agent: {
        id: string;
        department: string;
        role: string;
        does: string;
        name?: string;
        model?: string;
      };
    }
  | { type: "agent.remove"; reqId: string; agentId: string }
  | {
      type: "agent.update";
      reqId: string;
      agentId: string;
      /** Only the fields being changed. `model: null` means the office default. */
      fields: { role?: string; does?: string; department?: string; model?: string | null };
    }
  | { type: "department.create"; reqId: string; id: string; label: string }
  | { type: "department.rename"; reqId: string; id: string; label: string }
  | { type: "department.remove"; reqId: string; id: string }
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
  | {
      type: "doctor.result";
      reqId: string;
      seq: number;
      checks: DoctorCheck[];
      ok: boolean;
    }
  /**
   * What each provider answered, and what it could not.
   *
   * A provider that failed is a row with an `error`, not a missing row. A list
   * that silently dropped the one provider whose key is wrong would be a list
   * that says "you have no Anthropic models" when the truth is "your key was
   * refused" — the same screen the owner would go to in order to fix it.
   */
  | {
      type: "models.result";
      reqId: string;
      seq: number;
      providers: { id: string; models: ModelInfo[]; error?: string }[];
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
