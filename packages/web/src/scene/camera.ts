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
