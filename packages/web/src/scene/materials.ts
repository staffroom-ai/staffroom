/**
 * The office's materials and palette.
 *
 * The idea is an architect's model on a drafting table: matte card and chipboard,
 * warm paper light, departments annotated in coloured pencil rather than picked
 * out in primaries. Saturated hues are what make a 3D scene read as a toy, so
 * every colour here is desaturated and close in value, and one accent does all the
 * interactive work.
 */
import { Color } from "three";

/** Warm near-black, never pure black: pure black reads as a hole, not a surface. */
export const INK = "#22201c";

export const LIGHT = {
  table: new Color("#e8e4db"),
  floor: new Color("#d9d3c7"),
  floorEdge: new Color("#c8c1b2"),
  desk: new Color("#bfb6a4"),
  chair: new Color("#a9a08e"),
  brain: new Color("#f3f0e8"),
  screenOn: new Color("#dfe7f0"),
  screenOff: new Color("#b3ab9a"),
} as const;

export const DARK = {
  table: new Color("#191a1d"),
  floor: new Color("#232529"),
  floorEdge: new Color("#2c2f34"),
  desk: new Color("#34373d"),
  chair: new Color("#2a2d32"),
  brain: new Color("#3d4148"),
  screenOn: new Color("#5b7ba6"),
  screenOff: new Color("#2a2d32"),
} as const;

/**
 * Departments in coloured pencil: six hues at low saturation and close value, so
 * they name a pod without competing with each other or with the people.
 */
export const POD_PENCIL = [
  "#8c6b5d", // terracotta
  "#6e7f6a", // sage
  "#9c8a5e", // ochre
  "#5e6b84", // slate
  "#7a6480", // plum
  "#5c7b7d", // teal
] as const;

/** Slightly lifted for dark, where the same hue at the same value disappears. */
export const POD_PENCIL_DARK = [
  "#a8806f", // terracotta
  "#87997f", // sage
  "#b8a271", // ochre
  "#7383a0", // slate
  "#957c9c", // plum
  "#6f9497", // teal
] as const;

export function podPencil(pod: number, dark: boolean): string {
  const palette = dark ? POD_PENCIL_DARK : POD_PENCIL;
  return palette[pod % palette.length] as string;
}

/**
 * Status, and the one accent.
 *
 * These stay a little more saturated than the furniture because they carry
 * meaning, but they are still muted: a status badge should read at a glance
 * without shouting across the room.
 */
export const STATUS = {
  idle: new Color("#9a9384"),
  working: new Color("#4f7d5e"),
  waiting: new Color("#b07f3c"),
  error: new Color("#a8534a"),
} as const;

export const STATUS_DARK = {
  idle: new Color("#6f6a5e"),
  working: new Color("#6aa37c"),
  waiting: new Color("#d2a05c"),
  error: new Color("#cf7268"),
} as const;

export function statusColour(
  status: "idle" | "working" | "waiting_approval" | "error",
  dark = false,
): Color {
  const palette = dark ? STATUS_DARK : STATUS;
  switch (status) {
    case "working":
      return palette.working;
    case "waiting_approval":
      return palette.waiting;
    case "error":
      return palette.error;
    default:
      return palette.idle;
  }
}

export function surfaces(dark: boolean): typeof LIGHT {
  return dark ? (DARK as unknown as typeof LIGHT) : LIGHT;
}

/**
 * Matte, never shiny. Roughness near 1 with no metalness is what makes card look
 * like card; a glossy highlight is the single biggest tell that a scene is plastic.
 */
export const SURFACE_ROUGHNESS = 0.92;
export const SURFACE_METALNESS = 0;
