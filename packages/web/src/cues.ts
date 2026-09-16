/**
 * Turning run events into things the office does on screen.
 *
 * One rule governs this file: a cue is a hint, never a source of truth. An agent's
 * colour comes from `state.agents[].status`, so a cue that is dropped, arrives
 * late, or is replayed twice can make the office look briefly wrong but never
 * leaves it wrong.
 */
import type { RunEvent, RunEventEnvelope } from "@staffroom/core";

export type CueKind =
  | "walk_to_lead"
  | "walk_back"
  | "type_start"
  | "type_stop"
  | "raise_hand"
  | "lower_hand"
  | "shrug"
  | "slump"
  | "paper_to_brain"
  | "monitor_flash"
  | "connector_pulse";

export interface AnimationCue {
  /** The envelope's seq, so replaying the same event twice produces one cue. */
  id: number;
  kind: CueKind;
  agentId: string;
  /** For connector_pulse. */
  connectorId?: string;
  at: number;
}

export interface ActivityLine {
  id: number;
  runId: string;
  agentId: string;
  at: number;
  text: string;
  tone: "normal" | "waiting" | "bad";
}

export interface Ingested {
  cues: AnimationCue[];
  activity: ActivityLine[];
}

/** The text of a line an owner reads in the Activity feed. */
function describe(
  event: RunEvent,
  agentName: string,
  nameOf: (agentId: string) => string,
): { text: string; tone: ActivityLine["tone"] } | undefined {
  switch (event.type) {
    case "started":
      return { text: `${agentName} started work.`, tone: "normal" };
    case "routed":
      // By name, not by id. The line right under this one says "Handed to Priya",
      // and an office that calls the same person two different things in two
      // consecutive lines does not look like it knows who works there.
      return { text: `Handed to ${nameOf(event.toAgentId)}.`, tone: "normal" };
    case "tool_call":
      return {
        text:
          event.egress && event.scope === "read"
            ? `${agentName} sent ${event.inputChars} characters to ${event.call.name}.`
            : `${agentName} used ${event.call.name}.`,
        tone: "normal",
      };
    case "tool_result":
      return event.isError
        ? { text: `${event.name} failed: ${event.output.slice(0, 120)}`, tone: "bad" }
        : undefined;
    case "approval_needed":
      return {
        text: `${agentName} is waiting for you to approve ${event.tool.name}.`,
        tone: "waiting",
      };
    case "approval_resolved":
      return event.decision === "deny"
        ? { text: "You declined it.", tone: "bad" }
        : event.decision === "approve"
          ? { text: "You approved it.", tone: "normal" }
          : undefined;
    case "brain_note_written":
      return { text: `Filed as ${event.noteId}.`, tone: "normal" };
    case "done":
      return { text: `${agentName} finished: ${event.deliverable.title}`, tone: "normal" };
    case "failed":
      return { text: event.error.message, tone: "bad" };
    default:
      return undefined;
  }
}

export interface IngestOptions {
  /** Every cue collapses to an instant state change when the viewer asked for that. */
  reducedMotion?: boolean;
  agentName?: (agentId: string) => string;
}

export function ingestEvent(envelope: RunEventEnvelope, options: IngestOptions = {}): Ingested {
  const { event, seq, at, runId } = envelope;
  const agentId = "agentId" in event ? event.agentId : options.agentName === undefined ? "" : "";
  const cues: AnimationCue[] = [];
  const activity: ActivityLine[] = [];

  const named = options.agentName?.(agentId) ?? agentId;
  const described = describe(event, named, (id) => options.agentName?.(id) ?? id);
  if (described !== undefined) {
    activity.push({ id: seq, runId, agentId, at, text: described.text, tone: described.tone });
  }

  if (options.reducedMotion === true) return { cues, activity };

  const cue = (kind: CueKind, extra: Partial<AnimationCue> = {}): void => {
    cues.push({ id: seq, kind, agentId, at, ...extra });
  };

  switch (event.type) {
    case "started":
      cue("type_start");
      break;
    case "chunk":
      cue("monitor_flash");
      break;
    case "tool_call":
      cue("connector_pulse", { connectorId: event.call.name });
      break;
    case "approval_needed":
      cue("raise_hand");
      break;
    case "approval_resolved":
      cue("lower_hand");
      if (event.decision === "deny") cue("shrug");
      break;
    case "brain_note_written":
      cue("paper_to_brain");
      break;
    case "done":
      cue("type_stop");
      break;
    case "failed":
      cue("type_stop");
      cue("slump");
      break;
    default:
      break;
  }

  return { cues, activity };
}

/** Drops cues already seen, so a replay does not animate the same run twice. */
export function dedupeCues(existing: AnimationCue[], incoming: AnimationCue[]): AnimationCue[] {
  const seen = new Set(existing.map((c) => `${c.id}:${c.kind}`));
  return incoming.filter((c) => !seen.has(`${c.id}:${c.kind}`));
}
