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
  frameOverview,
  inStage,
  lerpTarget,
  OVERVIEW,
  podFrustumFor,
  type StageBox,
} from "./camera.js";
import { Brain, Desks, Ground, PLATE_RADIUS, Pods } from "./Office.js";

/**
 * The middle grid column, measured. The camera frames to this rather than to the
 * window, because the panels sit over a full-bleed canvas. It is read from the DOM
 * instead of duplicating the CSS column widths here, so the two cannot drift.
 */
function useStageBox(): StageBox {
  const [box, setBox] = useState<StageBox>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    stageLeft: 0,
    stageWidth: window.innerWidth,
  }));

  useEffect(() => {
    const stage = document.querySelector(".stage");
    const read = (): void => {
      const rect = stage?.getBoundingClientRect();
      setBox({
        width: window.innerWidth,
        height: window.innerHeight,
        stageLeft: rect?.left ?? 0,
        stageWidth: rect?.width ?? window.innerWidth,
      });
    };
    read();
    window.addEventListener("resize", read);
    const observer = stage === null ? undefined : new ResizeObserver(read);
    if (stage !== null) observer?.observe(stage);
    return () => {
      window.removeEventListener("resize", read);
      observer?.disconnect();
    };
  }, []);

  return box;
}

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
  const [dark, setDark] = useState(false);
  const stageBox = useStageBox();

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // The office follows the viewer's theme, and the model is lit differently in
  // each: the same scene under warm paper light and under lamplight.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(query.matches);
    const listener = (event: MediaQueryListEvent): void => setDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // One target, whatever caused it to change. Every branch goes through the stage
  // so a pod close-up is centred in the same space the overview is.
  const target: CameraTarget = useMemo(() => {
    if (selectedAgentId !== null) {
      const agent = state.agents.find((a) => a.id === selectedAgentId);
      const pod = state.departments.find((d) => d.id === agent?.departmentId)?.pod;
      if (agent !== undefined && pod !== undefined) {
        const seat = seatPosition(pod, agent.seat);
        return inStage({ x: seat.x, z: seat.z, frustum: 9, azimuth: OVERVIEW.azimuth }, stageBox);
      }
    }
    if (focusedPod !== null) return inStage(podFrustumFor(focusedPod), stageBox);
    return frameOverview(stageBox, PLATE_RADIUS);
  }, [selectedAgentId, focusedPod, state.agents, state.departments, stageBox]);

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <CameraRig target={target} />

      {/*
        One key light that actually casts, a cool fill so the shadow side is not
        dead, and a ground bounce. Dark is lit, not dimmed: the fill is stronger
        there than in light, because a dark room where the furniture disappears is
        an under-lit room, not a styled one.
      */}
      <hemisphereLight
        args={[dark ? "#5a6a80" : "#ffffff", dark ? "#0d1013" : "#c3ccd7", dark ? 1.1 : 0.7]}
      />
      <directionalLight
        position={[11, 15, 8]}
        intensity={dark ? 1.5 : 2.1}
        color={dark ? "#dce6f5" : "#fffaf2"}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      <directionalLight
        position={[-9, 7, -8]}
        intensity={dark ? 0.75 : 0.45}
        color={dark ? "#7f93ad" : "#dbe6f4"}
      />

      <Ground dark={dark} />
      <Brain dark={dark} />
      <Pods state={state} dark={dark} />
      <Desks state={state} dark={dark} />
      <Agents state={state} reducedMotion={reducedMotion} dark={dark} />
    </Canvas>
  );
}
