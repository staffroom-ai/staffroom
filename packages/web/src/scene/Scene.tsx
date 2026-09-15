/**
 * The office, assembled.
 *
 * The camera is driven from a target rather than from user input directly, so
 * every way of moving it (keys, clicking someone, Esc) is the same code path and
 * cannot get out of step.
 */

import { OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { OfficeState } from "@staffroom/core";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { seatPosition } from "../layout.js";
import { useOfficeStore } from "../store.js";
import { Agents } from "./Agents.js";
import {
  type CameraTarget,
  cameraPosition,
  FOCUS_MS,
  lerpTarget,
  OVERVIEW,
  podFrustumFor,
} from "./camera.js";
import { Brain, Desks, Floor, Pods } from "./Office.js";

function CameraRig({ target }: { target: CameraTarget }): ReactElement {
  const camera = useRef<never>(null);
  const from = useRef<CameraTarget>(OVERVIEW);
  const startedAt = useRef<number>(0);
  const previous = useRef<CameraTarget>(OVERVIEW);
  const goal = useRef<CameraTarget>(OVERVIEW);
  const { invalidate, size } = useThree();

  // The target is memoised upstream, so this fires when the office actually wants
  // the camera somewhere else rather than on every render, which used to restart
  // the transition every frame and stop it ever arriving.
  useEffect(() => {
    from.current = previous.current;
    goal.current = target;
    startedAt.current = performance.now();
    invalidate();
  }, [target, invalidate]);

  useFrame(() => {
    const t = Math.min(1, (performance.now() - startedAt.current) / FOCUS_MS);
    const current = lerpTarget(from.current, goal.current, t);
    previous.current = current;

    const node = camera.current as unknown as {
      position: { set: (x: number, y: number, z: number) => void };
      lookAt: (x: number, y: number, z: number) => void;
      left: number;
      right: number;
      top: number;
      bottom: number;
      zoom: number;
      updateProjectionMatrix: () => void;
    } | null;
    if (node === null) return;

    const p = cameraPosition(current.azimuth);
    node.position.set(current.x + p.x, p.y, current.z + p.z);
    node.lookAt(current.x, 0, current.z);

    // The frustum is set in world units rather than left to drei's pixel defaults
    // plus a zoom, which depends on how the camera was initialised and is easy to
    // get silently wrong.
    const aspect = size.width / Math.max(1, size.height);
    node.top = current.frustum;
    node.bottom = -current.frustum;
    node.left = -current.frustum * aspect;
    node.right = current.frustum * aspect;
    node.zoom = 1;
    node.updateProjectionMatrix();
  });

  return <OrthographicCamera ref={camera as never} makeDefault near={-100} far={200} />;
}

export function Scene({ state }: { state: OfficeState }): ReactElement {
  const selectedAgentId = useOfficeStore((s) => s.selectedAgentId);
  const focusedPod = useOfficeStore((s) => s.focusedPod);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // One target, whatever caused it to change.
  const target: CameraTarget = useMemo(() => {
    if (selectedAgentId !== null) {
      const agent = state.agents.find((a) => a.id === selectedAgentId);
      const pod = state.departments.find((d) => d.id === agent?.departmentId)?.pod;
      if (agent !== undefined && pod !== undefined) {
        const seat = seatPosition(pod, agent.seat);
        return { x: seat.x, z: seat.z, frustum: 9, azimuth: OVERVIEW.azimuth };
      }
    }
    if (focusedPod !== null) return podFrustumFor(focusedPod);
    return OVERVIEW;
  }, [selectedAgentId, focusedPod, state.agents, state.departments]);

  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <CameraRig target={target} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      <Floor />
      <Brain noteCount={state.latestDeliverables.length * 4 + 8} />
      <Pods state={state} />
      <Desks state={state} />
      <Agents state={state} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
