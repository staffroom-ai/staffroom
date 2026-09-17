/**
 * What the scene actually costs, for the perf test to read.
 *
 * The office is the part of this product somebody looks at all day, and a 3D
 * scene degrades quietly: nobody files a bug saying "the frame time went from
 * five milliseconds to twelve", they say it feels sluggish six months later and
 * by then the cause is thirty commits back. So the numbers are measured rather
 * than assumed, and the measurement lives in the app rather than in the test —
 * only the renderer knows how many draw calls it just made.
 *
 * It is off unless something asks. `window.__staffroomPerf` is created by the
 * test before the page loads; without it this is one `undefined` check per
 * frame, which is not a cost worth having an opinion about. Nothing is recorded
 * for an ordinary visitor and nothing is sent anywhere, ever.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";

export interface PerfSink {
  /** Milliseconds between consecutive rendered frames. */
  frames: number[];
  /** From the renderer, for the last frame drawn. */
  calls: number;
  triangles: number;
  /** When the first frame reached the screen, relative to navigation start. */
  firstFrameMs: number | null;
}

declare global {
  interface Window {
    __staffroomPerf?: PerfSink;
  }
}

/** Beyond this the oldest are dropped: a long recording is not a memory leak. */
const MAX_FRAMES = 4_000;

export function PerfProbe(): null {
  const { gl } = useThree();
  const last = useRef<number | null>(null);

  useFrame(() => {
    const sink = window.__staffroomPerf;
    if (sink === undefined) return;

    const now = performance.now();
    if (sink.firstFrameMs === null) sink.firstFrameMs = now;

    // The gap between frames, not the time spent inside this callback. What a
    // person perceives is how long the picture stood still, and that includes
    // everything the browser did between frames rather than only our part.
    if (last.current !== null) {
      sink.frames.push(now - last.current);
      if (sink.frames.length > MAX_FRAMES) sink.frames.shift();
    }
    last.current = now;

    sink.calls = gl.info.render.calls;
    sink.triangles = gl.info.render.triangles;
  });

  return null;
}

/** The p95 of a list of frame gaps, or 0 when there is nothing to say. */
export function p95(frames: number[]): number {
  if (frames.length === 0) return 0;
  const sorted = [...frames].sort((a, b) => a - b);
  // The worst 5% is where sluggishness lives: an average hides a scene that is
  // smooth most of the time and stutters whenever an agent starts walking.
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index] ?? 0;
}
