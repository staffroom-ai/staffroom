/**
 * The office's palette, as plain colour values.
 *
 * Deliberately free of any three.js import. The HUD needs the department pencils
 * to colour a card or a name, and `materials.ts` next door constructs three
 * Colors; if the two lived together, importing a hex string into the interface
 * would drag the whole renderer — 1.2 MB of it — into the bundle every visitor
 * downloads, including the ones who only ever see the list view.
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

/** Cool near-black, never pure black: pure black reads as a hole, not a surface. */
export const INK = "#12171d";

/** The interface accent, and the light inside the Brain. One accent, one job. */
export const ACCENT = "#1a46d6";
export const ACCENT_DARK = "#7fa0ff";

/**
 * Departments in coloured pencil: six hues at one saturation and one value, so no
 * department shouts over another. They sit on the floor, never on a person, which
 * keeps "which team" and "what is that person doing" separate questions: people
 * themselves are neutral figures, and the only colour they carry is their status.
 */
export const POD_PENCIL = [
  "#9f6850", // rust
  "#7d9f50", // moss
  "#509f75", // jade
  "#50829f", // steel
  "#68509f", // iris
  "#9f5082", // magenta
] as const;

/** Lifted for dark, where the same value against a dark floor disappears. */
export const POD_PENCIL_DARK = [
  "#c38f79",
  "#a3c379",
  "#79c39c",
  "#79a8c3",
  "#8f79c3",
  "#c379a8",
] as const;

/**
 * Spread the departments across the whole pencil palette rather than taking the
 * first N. With three departments, indices 0,1,2 gave rust, moss and jade — two
 * of them green, which is exactly the confusion the pencils exist to prevent.
 * Striding gives rust, jade and iris instead.
 */
export function podPencil(pod: number, dark: boolean, podCount = 0): string {
  const palette = dark ? POD_PENCIL_DARK : POD_PENCIL;
  const stride = podCount > 0 ? Math.max(1, Math.floor(palette.length / podCount)) : 1;
  return palette[(pod * stride) % palette.length] as string;
}
