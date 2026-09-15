/**
 * What an agent is doing right now, on screen.
 *
 * Cues arrive as events and become timelines here. The important property is that
 * a timeline only ever affects position and gesture: colour comes from the
 * office's own status, so a missed or duplicated cue cannot leave anyone looking
 * like they are in a state they are not.
 */

import type { AnimationCue, CueKind } from "../cues.js";
import { type Point, pathBetween, pointAlong } from "../layout.js";

export const WALK_MS = 1200;
export const PAPER_MS = 900;
export const GESTURE_MS = 400;

export interface Timeline {
  kind: CueKind;
  startedAt: number;
  durationMs: number;
  path?: Point[];
}

export interface AgentMotion {
  position: Point;
  /** 0 to 1 while a gesture plays, for the scene to lean or raise an arm. */
  gesture: number;
  handRaised: boolean;
  typing: boolean;
  slumped: boolean;
}

const DURATIONS: Partial<Record<CueKind, number>> = {
  walk_to_lead: WALK_MS,
  walk_back: WALK_MS,
  paper_to_brain: PAPER_MS,
  shrug: GESTURE_MS,
  slump: GESTURE_MS,
  monitor_flash: 160,
  connector_pulse: 600,
};

export function timelineFor(cue: AnimationCue, now: number, from: Point, to: Point): Timeline {
  const durationMs = DURATIONS[cue.kind] ?? GESTURE_MS;
  const walks = cue.kind === "walk_to_lead" || cue.kind === "walk_back";
  return walks
    ? { kind: cue.kind, startedAt: now, durationMs, path: pathBetween(from, to) }
    : { kind: cue.kind, startedAt: now, durationMs };
}

/**
 * The state of one agent at a moment. Flags that describe a condition rather than
 * a movement (typing, hand raised) persist until their opposite cue arrives; the
 * rest expire on their own.
 */
export class AgentTimelines {
  private readonly active: Timeline[] = [];
  private typing = false;
  private handRaised = false;
  private slumped = false;
  private readonly seat: Point;

  constructor(seat: Point) {
    this.seat = seat;
  }

  push(cue: AnimationCue, now: number, target: Point = this.seat): void {
    switch (cue.kind) {
      case "type_start":
        this.typing = true;
        return;
      case "type_stop":
        this.typing = false;
        return;
      case "raise_hand":
        this.handRaised = true;
        return;
      case "lower_hand":
        this.handRaised = false;
        return;
      default:
        break;
    }
    if (cue.kind === "slump") this.slumped = true;
    this.active.push(timelineFor(cue, now, this.seat, target));
  }

  /** Called every frame. Drops whatever has finished. */
  sample(now: number): AgentMotion {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const timeline = this.active[i] as Timeline;
      if (now - timeline.startedAt >= timeline.durationMs) this.active.splice(i, 1);
    }

    let position = this.seat;
    let gesture = 0;

    for (const timeline of this.active) {
      const t = Math.min(1, (now - timeline.startedAt) / timeline.durationMs);
      if (timeline.path !== undefined) {
        // Out and back within one cue, so an agent always ends at their desk.
        const there = timeline.kind === "walk_back" ? 1 - t : t;
        position = pointAlong(timeline.path, there);
      } else {
        gesture = Math.max(gesture, Math.sin(t * Math.PI));
      }
    }

    return {
      position,
      gesture,
      handRaised: this.handRaised,
      typing: this.typing,
      slumped: this.slumped && this.active.some((a) => a.kind === "slump"),
    };
  }

  get busy(): boolean {
    return this.active.length > 0;
  }
}

/** Every cue collapses to its end state when the viewer asked for less motion. */
export function applyInstantly(cue: AnimationCue, timelines: AgentTimelines, now: number): void {
  if (
    cue.kind === "type_start" ||
    cue.kind === "type_stop" ||
    cue.kind === "raise_hand" ||
    cue.kind === "lower_hand"
  ) {
    timelines.push(cue, now);
  }
}
