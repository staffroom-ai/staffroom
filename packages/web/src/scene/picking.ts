/**
 * Clicking on someone.
 *
 * Instanced meshes have no per-object raycast worth using, so the scene registers
 * a screen-space rectangle per agent each frame and hit-testing is a loop over an
 * array. It is also what lets picking be tested without a WebGL context.
 */

export interface PickRect {
  id: string;
  kind: "agent" | "pod";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nearer things win when rectangles overlap. */
  depth: number;
}

export class PickRegistry {
  private rects: PickRect[] = [];

  replace(rects: PickRect[]): void {
    this.rects = rects;
  }

  clear(): void {
    this.rects = [];
  }

  get size(): number {
    return this.rects.length;
  }

  /** The nearest thing under the pointer, or nothing. */
  at(x: number, y: number): PickRect | undefined {
    let best: PickRect | undefined;
    for (const rect of this.rects) {
      if (x < rect.x || x > rect.x + rect.width) continue;
      if (y < rect.y || y > rect.y + rect.height) continue;
      // An agent always wins over the pod label behind them.
      if (best === undefined || rect.depth < best.depth) best = rect;
    }
    return best;
  }
}

/** World point to screen pixels, for an orthographic isometric camera. */
export function projectToScreen(
  point: { x: number; y?: number; z: number },
  camera: { azimuth: number; frustum: number; x: number; z: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const a = (camera.azimuth * Math.PI) / 180;
  const dx = point.x - camera.x;
  const dz = point.z - camera.z;

  const right = dx * Math.cos(a) - dz * Math.sin(a);
  const forward = dx * Math.sin(a) + dz * Math.cos(a);
  const up = point.y ?? 0;

  const scale = viewport.height / (camera.frustum * 2);
  return {
    x: viewport.width / 2 + right * scale,
    // Isometric foreshortening: half a unit of depth per unit forward.
    y: viewport.height / 2 + (forward * 0.5 - up) * scale,
  };
}
