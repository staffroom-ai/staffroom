/**
 * Where the camera sits and how it moves.
 *
 * Isometric on purpose: an orthographic camera at 35.264 degrees is the angle that
 * makes a cube's three visible faces equal, which is what makes the office read as
 * a floor plan you can see into rather than a photograph of a room.
 */

/** atan(1/sqrt(2)) in degrees: true isometric. */
export const ISO_ELEVATION = 35.264;
export const OVERVIEW_AZIMUTH = 45;
export const OVERVIEW_FRUSTUM = 13.2;
export const AGENT_FRUSTUM = 6;
export const POD_FRUSTUM = 8;
export const ORBIT_STEP = 45;
export const ORBIT_MS = 400;
export const FOCUS_MS = 500;

export interface CameraTarget {
  x: number;
  z: number;
  frustum: number;
  azimuth: number;
}

/**
 * The overview is deliberately off-centre: the interface holds a column of panels
 * on the left and a rail on the right, so a plate centred in the viewport is not
 * centred in the space the viewer can actually see. This offset puts the middle of
 * the office in the middle of the gap between them.
 */
export const OVERVIEW: CameraTarget = {
  x: -2.6,
  z: -0.6,
  frustum: OVERVIEW_FRUSTUM,
  azimuth: OVERVIEW_AZIMUTH,
};

/** Camera position for an azimuth, at a fixed distance and the iso elevation. */
export function cameraPosition(
  azimuth: number,
  distance = 30,
): { x: number; y: number; z: number } {
  const a = (azimuth * Math.PI) / 180;
  const e = (ISO_ELEVATION * Math.PI) / 180;
  return {
    x: Math.sin(a) * Math.cos(e) * distance,
    y: Math.sin(e) * distance,
    z: Math.cos(a) * Math.cos(e) * distance,
  };
}

export function orbit(azimuth: number, direction: 1 | -1): number {
  return (azimuth + direction * ORBIT_STEP + 360) % 360;
}

/** Ease-out, so a move settles rather than stopping dead. */
export function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export function lerpTarget(from: CameraTarget, to: CameraTarget, t: number): CameraTarget {
  const k = ease(t);
  // Take the short way round rather than spinning the office 315 degrees.
  let delta = to.azimuth - from.azimuth;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return {
    x: from.x + (to.x - from.x) * k,
    z: from.z + (to.z - from.z) * k,
    frustum: from.frustum + (to.frustum - from.frustum) * k,
    azimuth: (from.azimuth + delta * k + 360) % 360,
  };
}

/** Panning stops at the floor edge so the office cannot be lost off-screen. */
export function clampToFloor(x: number, z: number, floorSize: number): { x: number; z: number } {
  const limit = floorSize / 2;
  return { x: Math.min(limit, Math.max(-limit, x)), z: Math.min(limit, Math.max(-limit, z)) };
}

export const ZOOM_MIN = 5;
export const ZOOM_MAX = 26;

export function zoom(frustum: number, delta: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, frustum + delta));
}

/** Looking at one pod: close enough to read the desks, wide enough to see the pod. */
export function podFrustumFor(pod: number): CameraTarget {
  const angle = (pod / 6) * Math.PI * 2;
  return {
    x: Math.sin(angle) * 8,
    z: -Math.cos(angle) * 8,
    frustum: POD_FRUSTUM,
    azimuth: OVERVIEW_AZIMUTH,
  };
}

/* ── framing to the stage, not to the window ──────────────────────────────── */

/**
 * The canvas is full-bleed behind the panels, so the space the viewer can
 * actually see the office in is the middle grid column, not the window. Framing
 * to the window gets it twice: the plate is zoomed as if it had the full width,
 * so the rail crops it, and it is centred on the window, so it sits off-centre in
 * the gap. Both fall out of the stage's real box, which also means the framing
 * follows the panels when they collapse at narrow widths instead of guessing.
 */
export interface StageBox {
  width: number;
  height: number;
  stageLeft: number;
  stageWidth: number;
}

/** A little air between the plate's edge and the panels. */
const PLATE_MARGIN = 1.06;

/** sin(iso elevation): a ground circle reads as an ellipse this much flatter. */
const ISO_SIN = Math.sin((ISO_ELEVATION * Math.PI) / 180);

/**
 * How far to move the camera target so that world origin lands in the middle of
 * the stage rather than the middle of the window. Screen-right in world terms is
 * (cos azimuth, 0, -sin azimuth); moving the target along it slides the image the
 * other way, hence the negation.
 */
export function stageShift(
  view: StageBox,
  frustum: number,
  azimuth: number,
): { x: number; z: number } {
  const offsetPx = view.stageLeft + view.stageWidth / 2 - view.width / 2;
  const offsetWorld = (offsetPx * 2 * frustum) / Math.max(1, view.height);
  const a = (azimuth * Math.PI) / 180;
  return { x: -offsetWorld * Math.cos(a), z: offsetWorld * Math.sin(a) };
}

/** The overview, zoomed so the whole plate fits the stage and centred in it. */
export function frameOverview(
  view: StageBox,
  radius: number,
  azimuth = OVERVIEW_AZIMUTH,
): CameraTarget {
  const height = Math.max(1, view.height);
  const stage = Math.max(1, view.stageWidth);
  const wanted = radius * PLATE_MARGIN;
  // Horizontally, `stage` pixels have to span `wanted` world units either side.
  const byWidth = (wanted * height) / stage;
  // Vertically the plate is flatter, but the desks and labels stand above it.
  const byHeight = wanted * ISO_SIN + 1.6;
  const frustum = Math.max(byWidth, byHeight);
  const shift = stageShift(view, frustum, azimuth);
  return { x: shift.x, z: shift.z, frustum, azimuth };
}

/** Any close-up target, nudged the same way so it too lands in the stage. */
export function inStage(target: CameraTarget, view: StageBox): CameraTarget {
  const shift = stageShift(view, target.frustum, target.azimuth);
  return { ...target, x: target.x + shift.x, z: target.z + shift.z };
}
