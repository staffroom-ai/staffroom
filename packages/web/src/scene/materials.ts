/**
 * The office's materials and palette. Direction: Floorplate.
 *
 * The office is a lit floorplate standing clear of a darker ground, the way a
 * site model stands on a table. The whole point of this palette is figure and
 * ground: the ground, the plate, the furniture and the people each sit on their
 * own value step, so a glance separates them before any label is read.
 *
 * Three families of colour, each with one job and no overlap:
 *
 *   surfaces   neutral, cool, no hue competition — the room itself
 *   pencil     six desaturated department hues — identity, on the floor only
 *   status     working / waiting / error — the only saturated colour on a person
 *
 * The one accent (ultramarine) belongs to the interface and to the Brain at the
 * centre of the floor. It appears nowhere else.
 */
import { Color } from "three";

// The palette itself has no three.js import, so the interface can take a colour
// from it without pulling the renderer in. Re-exported here because everything
// in the scene reasonably expects to find all of it in one place.
export {
  ACCENT,
  ACCENT_DARK,
  INK,
  POD_PENCIL,
  POD_PENCIL_DARK,
  podPencil,
} from "./palette.js";

// Also imported, not just re-exported: the materials below use them.
import { ACCENT, ACCENT_DARK } from "./palette.js";

/**
 * Surfaces, in value order. `floor` is the brightest thing in light and the
 * furniture is the brightest thing in dark: the inversion is deliberate, because
 * furniture darker than a dark floor is furniture you cannot see.
 */
export const LIGHT = {
  /** Behind the plate. Never the same value as the plate. */
  ground: new Color("#ccd3dc"),
  floor: new Color("#f4f6f9"),
  floorEdge: new Color("#bcc5cf"),
  desk: new Color("#b6bec8"),
  deskEdge: new Color("#959fac"),
  chair: new Color("#7f8a97"),
  brain: new Color("#c9d1db"),
  screenOn: new Color("#f4f7ff"),
  screenOff: new Color("#6d7886"),
  paper: new Color("#ffffff"),
  /** People read as dark figures on a light floor, and light figures on a dark one. */
  figure: new Color("#3f4a57"),
  figureHead: new Color("#55616f"),
} as const;

export const DARK = {
  ground: new Color("#0d1013"),
  floor: new Color("#333d47"),
  floorEdge: new Color("#454f5a"),
  desk: new Color("#69747f"),
  deskEdge: new Color("#7d8894"),
  chair: new Color("#4c5661"),
  brain: new Color("#4a5663"),
  screenOn: new Color("#cfdcff"),
  screenOff: new Color("#2a323b"),
  paper: new Color("#cbd4de"),
  figure: new Color("#cdd6e0"),
  figureHead: new Color("#d9e2eb"),
} as const;

/**
 * Status. The only saturated colour allowed on a person, because "is this one
 * busy" is the question the office exists to answer.
 */
export const STATUS = {
  idle: new Color("#98a3af"),
  working: new Color("#1f8a52"),
  waiting: new Color("#c07a11"),
  error: new Color("#c0392b"),
} as const;

export const STATUS_DARK = {
  idle: new Color("#6a7581"),
  working: new Color("#4bd48c"),
  waiting: new Color("#f0b45c"),
  error: new Color("#ff7a68"),
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

export function accent(dark: boolean): string {
  return dark ? ACCENT_DARK : ACCENT;
}

/**
 * Relative luminance, so value separation can be asserted rather than eyeballed.
 *
 * A three Color holds its channels in the linear working space, so measuring one
 * has to go back through its sRGB hex rather than reading `.r` directly — doing
 * the latter applies the transfer curve twice and quietly reports the wrong
 * contrast.
 */
export function luminanceOf(colour: Color | string): number {
  const hex = typeof colour === "string" ? colour.replace("#", "") : colour.getHexString();
  const channel = (pair: string): number => {
    const v = Number.parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(hex.slice(0, 2)) +
    0.7152 * channel(hex.slice(2, 4)) +
    0.0722 * channel(hex.slice(4, 6))
  );
}

/** Contrast ratio between two surfaces, the WCAG way. */
export function contrastOf(a: Color | string, b: Color | string): number {
  const x = luminanceOf(a);
  const y = luminanceOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Matte, never shiny. Roughness near 1 with no metalness is what makes card look
 * like card; a glossy highlight is the single biggest tell that a scene is plastic.
 */
export const SURFACE_ROUGHNESS = 0.9;
export const SURFACE_METALNESS = 0;
