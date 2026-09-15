import { describe, expect, it } from "vitest";
import type { AnimationCue } from "../cues.js";
import {
  cameraPosition,
  clampToFloor,
  ease,
  ISO_ELEVATION,
  lerpTarget,
  OVERVIEW,
  orbit,
  podFrustumFor,
  ZOOM_MAX,
  ZOOM_MIN,
  zoom,
} from "./camera.js";
import { MATERIALS, statusColour } from "./materials.js";
import { PickRegistry, projectToScreen } from "./picking.js";
import { AgentTimelines, timelineFor, WALK_MS } from "./timeline.js";

describe("the camera", () => {
  it("sits at the angle that makes a cube's three faces equal", () => {
    // True isometric; anything else and the office reads as a photograph.
    expect(ISO_ELEVATION).toBeCloseTo((Math.atan(1 / Math.SQRT2) * 180) / Math.PI, 3);
  });

  it("keeps its distance whichever way it faces", () => {
    for (const azimuth of [0, 45, 90, 180, 315]) {
      const p = cameraPosition(azimuth, 30);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(30, 3);
    }
  });

  it("stays above the floor", () => {
    for (const azimuth of [0, 90, 180, 270]) expect(cameraPosition(azimuth).y).toBeGreaterThan(0);
  });

  it("turns in steps and wraps around", () => {
    expect(orbit(0, 1)).toBe(45);
    expect(orbit(315, 1)).toBe(0);
    expect(orbit(0, -1)).toBe(315);
  });

  it("takes the short way round rather than spinning the office", () => {
    const from = { ...OVERVIEW, azimuth: 350 };
    const to = { ...OVERVIEW, azimuth: 10 };
    const half = lerpTarget(from, to, 0.5);
    // Through 0, not backwards through 180.
    expect(half.azimuth === 0 || half.azimuth > 350 || half.azimuth < 10).toBe(true);
  });

  it("settles rather than stopping dead", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });

  it("clamps a move at the end and the start", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("will not let the office be lost off-screen", () => {
    expect(clampToFloor(100, -100, 24)).toEqual({ x: 12, z: -12 });
    expect(clampToFloor(3, 4, 24)).toEqual({ x: 3, z: 4 });
  });

  it("zooms within limits", () => {
    expect(zoom(18, -50)).toBe(ZOOM_MIN);
    expect(zoom(18, 50)).toBe(ZOOM_MAX);
    expect(zoom(18, -2)).toBe(16);
  });

  it("puts a focused pod on the ring", () => {
    const target = podFrustumFor(2);
    expect(Math.hypot(target.x, target.z)).toBeCloseTo(8, 3);
  });
});

describe("picking", () => {
  const registry = new PickRegistry();

  it("finds what is under the pointer", () => {
    registry.replace([
      { id: "priya", kind: "agent", x: 10, y: 10, width: 40, height: 60, depth: 1 },
    ]);
    expect(registry.at(20, 30)?.id).toBe("priya");
    expect(registry.at(200, 30)).toBeUndefined();
  });

  it("puts a person in front of the pod label behind them", () => {
    registry.replace([
      { id: "marketing", kind: "pod", x: 0, y: 0, width: 100, height: 100, depth: 5 },
      { id: "priya", kind: "agent", x: 10, y: 10, width: 40, height: 60, depth: 1 },
    ]);
    expect(registry.at(20, 30)?.id).toBe("priya");
  });

  it("empties when the scene does", () => {
    registry.replace([{ id: "a", kind: "agent", x: 0, y: 0, width: 10, height: 10, depth: 1 }]);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.at(5, 5)).toBeUndefined();
  });

  it("puts the office's centre in the middle of the screen", () => {
    const at = projectToScreen(
      { x: 0, z: 0 },
      { azimuth: 45, frustum: 18, x: 0, z: 0 },
      { width: 800, height: 600 },
    );
    expect(at).toEqual({ x: 400, y: 300 });
  });

  it("moves things on screen when the camera turns", () => {
    const point = { x: 4, z: 0 };
    const a = projectToScreen(
      point,
      { azimuth: 0, frustum: 18, x: 0, z: 0 },
      { width: 800, height: 600 },
    );
    const b = projectToScreen(
      point,
      { azimuth: 90, frustum: 18, x: 0, z: 0 },
      { width: 800, height: 600 },
    );
    expect(a.x).not.toBeCloseTo(b.x, 1);
  });
});

describe("materials", () => {
  it("uses three for the whole office, which is what holds the frame budget", () => {
    expect(MATERIALS).toHaveLength(3);
  });

  it("gives every status its own colour", () => {
    const colours = (["idle", "working", "waiting_approval", "error"] as const).map((s) =>
      statusColour(s).getHexString(),
    );
    expect(new Set(colours).size).toBe(4);
  });
});

describe("timelines", () => {
  const seat = { x: 4, z: 4 };
  const cue = (kind: AnimationCue["kind"]): AnimationCue => ({
    id: 1,
    kind,
    agentId: "priya",
    at: 0,
  });

  it("gives a walk a path and a gesture none", () => {
    expect(timelineFor(cue("walk_to_lead"), 0, seat, { x: 0, z: 0 }).path).toBeDefined();
    expect(timelineFor(cue("shrug"), 0, seat, seat).path).toBeUndefined();
    expect(timelineFor(cue("walk_to_lead"), 0, seat, { x: 0, z: 0 }).durationMs).toBe(WALK_MS);
  });

  it("keeps someone at their desk when nothing is happening", () => {
    expect(new AgentTimelines(seat).sample(1000).position).toEqual(seat);
  });

  it("walks out and comes back to the same desk", () => {
    const timelines = new AgentTimelines(seat);
    timelines.push(cue("walk_to_lead"), 0, { x: 0, z: 0 });

    const midway = timelines.sample(WALK_MS / 2).position;
    expect(midway).not.toEqual(seat);

    // Whatever happens in between, the walk ends where it started.
    timelines.sample(WALK_MS + 1);
    expect(timelines.sample(WALK_MS + 2).position).toEqual(seat);
  });

  it("holds a raised hand until it is lowered, not for a fixed time", () => {
    const timelines = new AgentTimelines(seat);
    timelines.push(cue("raise_hand"), 0);
    expect(timelines.sample(60_000).handRaised).toBe(true);
    timelines.push(cue("lower_hand"), 60_000);
    expect(timelines.sample(60_001).handRaised).toBe(false);
  });

  it("treats typing the same way", () => {
    const timelines = new AgentTimelines(seat);
    timelines.push(cue("type_start"), 0);
    expect(timelines.sample(30_000).typing).toBe(true);
    timelines.push(cue("type_stop"), 30_000);
    expect(timelines.sample(30_001).typing).toBe(false);
  });

  it("forgets a gesture once it has played", () => {
    const timelines = new AgentTimelines(seat);
    timelines.push(cue("shrug"), 0);
    expect(timelines.busy).toBe(true);
    timelines.sample(5000);
    expect(timelines.busy).toBe(false);
  });

  it("never leaves someone away from their desk after everything finishes", () => {
    const timelines = new AgentTimelines(seat);
    for (const kind of ["walk_to_lead", "shrug", "paper_to_brain"] as const) {
      timelines.push(cue(kind), 0, { x: 0, z: 0 });
    }
    expect(timelines.sample(10_000).position).toEqual(seat);
  });
});
