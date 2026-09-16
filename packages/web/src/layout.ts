/**
 * Where everything sits on the floor.
 *
 * Pure arithmetic, kept out of the scene so the positions can be tested without a
 * WebGL context. The office is a ring of six pods around the Brain; the numbers
 * here are the whole floor plan.
 */

export const FLOOR_SIZE = 24;
export const POD_RING_RADIUS = 8;
export const POD_COUNT = 6;
export const SEATS_PER_POD = 6;
/** The pod that holds the reception desk seats one fewer. */
export const RECEPTION_POD = 4;

export interface Point {
  x: number;
  z: number;
}

/**
 * Pods are spread evenly around the ring, dividing the floor by however many
 * departments the office actually has rather than always by six. Three
 * departments sit at 0, 120 and 240 degrees and use the whole plate; with a fixed
 * sixth-of-a-circle they clustered on one side and the office read as abandoned.
 * `pod` is still the department's index from core; only where it lands is decided
 * here, which is a render-layer question.
 */
export function podPosition(pod: number, podCount: number = POD_COUNT): Point {
  const angle = (pod / Math.max(1, podCount)) * Math.PI * 2;
  return {
    x: round(Math.sin(angle) * POD_RING_RADIUS),
    z: round(-Math.cos(angle) * POD_RING_RADIUS),
  };
}

/** Which way a pod faces: always inward, towards the Brain. */
export function podFacing(pod: number, podCount: number = POD_COUNT): number {
  return (pod / Math.max(1, podCount)) * Math.PI * 2;
}

const DESK_SPREAD = 2.4;
const DESK_ROW_GAP = 1.6;

/**
 * Desks are two rows of three, facing the Brain. Seat order matches the roster, so
 * the first agent listed sits nearest the front left.
 */
export function seatPosition(pod: number, seat: number, podCount: number = POD_COUNT): Point {
  const centre = podPosition(pod, podCount);
  const facing = podFacing(pod, podCount);

  const column = seat % 3;
  const row = Math.floor(seat / 3);
  const localX = (column - 1) * DESK_SPREAD;
  const localZ = row * DESK_ROW_GAP;

  // Rotate the pod-local offset into world space.
  return {
    x: round(centre.x + localX * Math.cos(facing) - localZ * Math.sin(facing)),
    z: round(centre.z + localX * Math.sin(facing) + localZ * Math.cos(facing)),
  };
}

export function seatsInPod(pod: number): number {
  return pod === RECEPTION_POD ? SEATS_PER_POD - 1 : SEATS_PER_POD;
}

/** The Brain is at the origin; everything walks to and from it. */
export const BRAIN_POSITION: Point = { x: 0, z: 0 };

/**
 * A walking path with squared-off corners, so an agent crosses the floor rather
 * than cutting diagonally through the furniture.
 */
export function pathBetween(from: Point, to: Point): Point[] {
  const corner: Point = { x: from.x, z: to.z };
  const points = [from, corner, to];
  // A straight line needs no corner.
  return from.x === to.x || from.z === to.z ? [from, to] : points;
}

export function distanceOf(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    total += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
  }
  return round(total);
}

/** Position along a path, 0 to 1. */
export function pointAlong(path: Point[], t: number): Point {
  if (path.length === 0) return BRAIN_POSITION;
  if (t <= 0) return path[0] as Point;
  if (t >= 1) return path[path.length - 1] as Point;

  const total = distanceOf(path);
  if (total === 0) return path[0] as Point;

  let travelled = 0;
  const target = total * t;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    const leg = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    if (travelled + leg >= target) {
      const within = leg === 0 ? 0 : (target - travelled) / leg;
      return { x: round(a.x + (b.x - a.x) * within), z: round(a.z + (b.z - a.z) * within) };
    }
    travelled += leg;
  }
  return path[path.length - 1] as Point;
}

/** Six distinguishable hues, one per pod, readable in both themes. */
export const POD_COLOURS = [
  "#2457d6",
  "#2a8a5b",
  "#b7791f",
  "#7a3fbf",
  "#c0392b",
  "#177f8a",
] as const;

export function podColour(pod: number): string {
  return POD_COLOURS[pod % POD_COLOURS.length] as string;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
