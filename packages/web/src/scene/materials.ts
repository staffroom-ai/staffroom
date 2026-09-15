/**
 * Three materials for the whole office.
 *
 * Every object is one of: a surface, a screen, or a person. Keeping it to three
 * means the renderer can batch almost everything, which is what holds the frame
 * budget with 35 agents on screen.
 */
import { Color, MeshBasicMaterial, MeshToonMaterial } from "three";

/** Floors, desks, pods, the Brain. Vertex colours carry the variation. */
export const surfaceMaterial = new MeshToonMaterial({ vertexColors: true });

/** Monitors and status badges: unlit, so they read as emitting rather than lit. */
export const screenMaterial = new MeshBasicMaterial({ toneMapped: false });

/** People. Separate so a head colour can change without touching the furniture. */
export const bodyMaterial = new MeshToonMaterial({ vertexColors: true });

export const MATERIALS = [surfaceMaterial, screenMaterial, bodyMaterial];

export const COLOURS = {
  floor: new Color("#e9e7e0"),
  floorDark: new Color("#1a1c20"),
  desk: new Color("#c9c4b8"),
  brain: new Color("#f2efe6"),
  dim: new Color("#9a978f"),
  idle: new Color("#8d9099"),
  working: new Color("#2a8a5b"),
  waiting: new Color("#b7791f"),
  error: new Color("#c0392b"),
} as const;

export function statusColour(status: "idle" | "working" | "waiting_approval" | "error"): Color {
  switch (status) {
    case "working":
      return COLOURS.working;
    case "waiting_approval":
      return COLOURS.waiting;
    case "error":
      return COLOURS.error;
    default:
      return COLOURS.idle;
  }
}
