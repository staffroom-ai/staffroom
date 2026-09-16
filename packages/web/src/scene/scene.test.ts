import { describe, expect, it } from "vitest";
import type { AnimationCue } from "../cues.js";
import { podFacing, podPosition, seatPosition } from "../layout.js";
import {
  cameraPosition,
  clampToFloor,
  ease,
  frameOverview,
  ISO_ELEVATION,
  inStage,
  lerpTarget,
  OVERVIEW,
  orbit,
  podFrustumFor,
  stageShift,
  ZOOM_MAX,
  ZOOM_MIN,
  zoom,
} from "./camera.js";
import {
  ACCENT,
  ACCENT_DARK,
  contrastOf,
  DARK,
  LIGHT,
  luminanceOf,
  POD_PENCIL,
  podPencil,
  statusColour,
} from "./materials.js";
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

describe("the palette", () => {
  it("gives every status its own colour, in both themes", () => {
    for (const dark of [false, true]) {
      const colours = (["idle", "working", "waiting_approval", "error"] as const).map((s) =>
        statusColour(s, dark).getHexString(),
      );
      expect(new Set(colours).size, `dark=${dark}`).toBe(4);
    }
  });

  it("keeps the departments desaturated, which is what stops the office looking like a toy", () => {
    for (const hex of POD_PENCIL) {
      expect(saturationOf(hex), hex).toBeLessThan(0.4);
    }
  });

  it("keeps the departments close in value, so none of them shouts", () => {
    const lightness = POD_PENCIL.map(lightnessOf);
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThan(0.15);
  });

  it("lifts the departments in dark, where the same value would disappear", () => {
    for (let pod = 0; pod < 6; pod++) {
      expect(lightnessOf(podPencil(pod, true))).toBeGreaterThan(lightnessOf(podPencil(pod, false)));
    }
  });

  it("tells the six departments apart", () => {
    expect(new Set([0, 1, 2, 3, 4, 5].map((p) => podPencil(p, false))).size).toBe(6);
    // Striding must stay injective, or two departments share a pencil.
    for (const count of [2, 3, 4, 5, 6]) {
      const used = Array.from({ length: count }, (_, pod) => podPencil(pod, false, count));
      expect(new Set(used).size).toBe(count);
    }
  });
});

/**
 * Figure and ground is the whole direction, so it is asserted rather than left to
 * whoever next edits a hex. Every step of the model — the ground behind the plate,
 * the plate, the furniture on it, the people at it — has to be a different value
 * from the thing immediately behind it, in both themes.
 */
describe("figure and ground", () => {
  const themes = [
    { name: "light", c: LIGHT },
    { name: "dark", c: DARK },
  ] as const;

  it("never lets the plate sit at the same value as the ground behind it", () => {
    for (const { name, c } of themes) {
      expect(contrastOf(c.ground, c.floor), name).toBeGreaterThan(1.3);
    }
  });

  it("keeps the furniture off the floor it stands on", () => {
    for (const { name, c } of themes) {
      expect(contrastOf(c.floor, c.desk), name).toBeGreaterThan(1.5);
      expect(contrastOf(c.desk, c.chair), name).toBeGreaterThan(1.25);
    }
  });

  it("makes a person the strongest silhouette on the plate", () => {
    for (const { name, c } of themes) {
      expect(contrastOf(c.floor, c.figure), name).toBeGreaterThan(4.5);
    }
  });

  it("inverts the furniture in dark rather than dimming it", () => {
    // Light: dark furniture on a light floor. Dark: light furniture on a dark one.
    expect(luminanceOf(LIGHT.desk)).toBeLessThan(luminanceOf(LIGHT.floor));
    expect(luminanceOf(DARK.desk)).toBeGreaterThan(luminanceOf(DARK.floor));
    expect(luminanceOf(LIGHT.figure)).toBeLessThan(luminanceOf(LIGHT.floor));
    expect(luminanceOf(DARK.figure)).toBeGreaterThan(luminanceOf(DARK.floor));
  });

  it("gives the Brain its own value, so it is not an unexplained white puck", () => {
    for (const { name, c } of themes) {
      expect(contrastOf(c.floor, c.brain), name).toBeGreaterThan(1.2);
    }
  });

  it("spends the accent on one thing, and never on a department or a status", () => {
    const spent: string[] = [ACCENT, ACCENT_DARK];
    for (const hex of POD_PENCIL) {
      expect(spent).not.toContain(hex);
    }
    for (const dark of [false, true]) {
      for (const status of ["idle", "working", "waiting_approval", "error"] as const) {
        expect(spent).not.toContain(`#${statusColour(status, dark).getHexString()}`);
      }
    }
  });

  it("keeps the accent legible on the surface it is used on", () => {
    expect(contrastOf(ACCENT, "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastOf(ACCENT_DARK, "#171c22")).toBeGreaterThan(4.5);
  });
});

/** So the palette rules can be asserted rather than eyeballed. */
function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function lightnessOf(hex: string): number {
  const [r, g, b] = channels(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

function saturationOf(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max - min === 0 ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

describe("framing to the stage", () => {
  const desktop = { width: 1440, height: 900, stageLeft: 304, stageWidth: 724 };
  const radius = 13.2;

  it("zooms out far enough that the plate fits the stage, not the window", () => {
    const target = frameOverview(desktop, radius);
    // Half the stage, in world units, must cover the plate's radius.
    const worldPerPx = (target.frustum * 2) / desktop.height;
    const halfStageWorld = (desktop.stageWidth / 2) * worldPerPx;
    expect(halfStageWorld).toBeGreaterThan(radius);
  });

  it("puts the middle of the plate in the middle of the stage", () => {
    const target = frameOverview(desktop, radius);
    // Project world origin back to a screen x: the shift is along screen-right.
    const a = (target.azimuth * Math.PI) / 180;
    const alongRight = -(target.x * Math.cos(a) - target.z * Math.sin(a));
    const worldPerPx = (target.frustum * 2) / desktop.height;
    const screenX = desktop.width / 2 + alongRight / worldPerPx;
    expect(screenX).toBeCloseTo(desktop.stageLeft + desktop.stageWidth / 2, 6);
  });

  it("does not shift at all when the stage fills the window", () => {
    const full = { width: 1440, height: 900, stageLeft: 0, stageWidth: 1440 };
    const target = frameOverview(full, radius);
    expect(target.x).toBeCloseTo(0, 10);
    expect(target.z).toBeCloseTo(0, 10);
  });

  it("zooms in as the stage widens", () => {
    const narrow = frameOverview(desktop, radius);
    const wide = frameOverview({ ...desktop, stageWidth: 1100 }, radius);
    expect(wide.frustum).toBeLessThan(narrow.frustum);
  });

  it("never zooms in so far that the plate is taller than the view", () => {
    const veryWide = frameOverview({ ...desktop, stageWidth: 4000 }, radius);
    expect(veryWide.frustum).toBeGreaterThan(radius * Math.sin((35.264 * Math.PI) / 180));
  });

  it("moves a pod close-up into the stage by the same shift", () => {
    const pod = podFrustumFor(2);
    const shifted = inStage(pod, desktop);
    const shift = stageShift(desktop, pod.frustum, pod.azimuth);
    expect(shifted.x).toBeCloseTo(pod.x + shift.x, 10);
    expect(shifted.z).toBeCloseTo(pod.z + shift.z, 10);
    expect(shifted.frustum).toBe(pod.frustum);
  });
});

describe("the floor divides by the departments that exist", () => {
  it("spreads three departments evenly rather than clustering them in three sixths", () => {
    const thirds = [0, 1, 2].map((pod) => podPosition(pod, 3));
    // Evenly spread means each is the same distance from the Brain...
    const radii = thirds.map((p) => Math.hypot(p.x, p.z));
    // Coordinates are rounded in layout.ts, so compare to that precision.
    for (const r of radii) expect(r).toBeCloseTo(radii[0] as number, 3);
    // ...and 120 degrees apart, so the far side of the plate is not left empty.
    const bearing = (p: { x: number; z: number }): number =>
      ((Math.atan2(p.x, -p.z) * 180) / Math.PI + 360) % 360;
    expect(bearing(thirds[1] as { x: number; z: number })).toBeCloseTo(120, 2);
    expect(bearing(thirds[2] as { x: number; z: number })).toBeCloseTo(240, 2);
  });

  it("keeps pod 0 at the same place whatever the count, so the first department is stable", () => {
    expect(podPosition(0, 3)).toEqual(podPosition(0, 6));
  });

  it("faces every pod inward at any count", () => {
    for (const count of [2, 3, 4, 5, 6]) {
      for (let pod = 0; pod < count; pod++) {
        const centre = podPosition(pod, count);
        const facing = podFacing(pod, count);
        // Facing is the outward bearing; a seat in row 0 sits nearer the Brain
        // than the pod centre once the local offset is rotated by it.
        const front = seatPosition(pod, 1, count);
        expect(Math.hypot(front.x, front.z)).toBeLessThanOrEqual(
          Math.hypot(centre.x, centre.z) + 0.001,
        );
        expect(Number.isFinite(facing)).toBe(true);
      }
    }
  });
});
