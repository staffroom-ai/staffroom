/**
 * The floor, the Brain and the six pods.
 *
 * Everything static, drawn once. The furniture is instanced so 36 desks cost about
 * what one does.
 */

import { Html, Instance, Instances } from "@react-three/drei";
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import {
  FLOOR_SIZE,
  POD_COUNT,
  podColour,
  podFacing,
  podPosition,
  seatPosition,
  seatsInPod,
} from "../layout.js";
import { COLOURS } from "./materials.js";

const DIM_OPACITY = 0.4;

export function Floor(): ReactElement {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <meshToonMaterial color={COLOURS.floor} />
    </mesh>
  );
}

/** The Brain: a low cylinder with cards stood around it, one per area of the notes. */
export function Brain({ noteCount }: { noteCount: number }): ReactElement {
  const cards = Math.min(24, Math.max(6, noteCount));
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[1.6, 1.8, 0.6, 24]} />
        <meshToonMaterial color={COLOURS.brain} />
      </mesh>
      <Instances limit={24} range={cards}>
        <boxGeometry args={[0.28, 0.4, 0.02]} />
        <meshToonMaterial color={COLOURS.desk} />
        {Array.from({ length: cards }, (_, i) => {
          const angle = (i / cards) * Math.PI * 2;
          return (
            <Instance
              key={`card-${angle.toFixed(4)}`}
              position={[Math.sin(angle) * 1.3, 0.8, Math.cos(angle) * 1.3]}
              rotation={[0, angle, 0]}
            />
          );
        })}
      </Instances>
    </group>
  );
}

export function Pods({ state }: { state: OfficeState }): ReactElement {
  const used = new Set<number>(state.departments.map((d) => d.pod));

  return (
    <>
      {Array.from({ length: POD_COUNT }, (_, pod) => {
        const { x, z } = podPosition(pod);
        const department = state.departments.find((d) => (d.pod as number) === pod);
        const inUse = used.has(pod);

        return (
          <group key={`pod-at-${x}-${z}`} position={[x, 0, z]} rotation={[0, podFacing(pod), 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 1]} receiveShadow>
              <circleGeometry args={[3.4, 24]} />
              <meshToonMaterial
                color={podColour(pod)}
                transparent
                // An empty pod is dimmed rather than hidden: the office has six,
                // and hiding them would make it look smaller than it is.
                opacity={inUse ? 0.22 : DIM_OPACITY * 0.22}
              />
            </mesh>
            {department !== undefined && (
              <Html position={[0, 0.05, 3.6]} center zIndexRange={[10, 0]} occlude={false}>
                <div
                  style={{
                    font: "600 11px/1.2 system-ui, -apple-system, sans-serif",
                    color: podColour(pod),
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  {department.name}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/** Every desk, chair and monitor in the office, in three instanced draws. */
export function Desks({ state }: { state: OfficeState }): ReactElement {
  const seats = [];
  for (let pod = 0; pod < POD_COUNT; pod++) {
    for (let seat = 0; seat < seatsInPod(pod); seat++) {
      const { x, z } = seatPosition(pod, seat);
      seats.push({ key: `${pod}-${seat}`, x, z, facing: podFacing(pod), pod });
    }
  }

  const occupied = new Set(
    state.agents
      .map((a) => {
        const pod = state.departments.find((d) => d.id === a.departmentId)?.pod;
        return pod === undefined ? undefined : `${pod}-${a.seat}`;
      })
      .filter((k): k is string => k !== undefined),
  );

  return (
    <>
      <Instances limit={36} range={seats.length}>
        <boxGeometry args={[1.4, 0.08, 0.8]} />
        <meshToonMaterial color={COLOURS.desk} />
        {seats.map((s) => (
          <Instance key={s.key} position={[s.x, 0.72, s.z]} rotation={[0, s.facing, 0]} />
        ))}
      </Instances>

      <Instances limit={36} range={seats.length}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshToonMaterial color={COLOURS.dim} />
        {seats.map((s) => (
          <Instance
            key={s.key}
            position={[s.x - Math.sin(s.facing) * 0.9, 0.45, s.z - Math.cos(s.facing) * 0.9]}
            rotation={[0, s.facing, 0]}
          />
        ))}
      </Instances>

      <Instances limit={36} range={seats.length}>
        <boxGeometry args={[0.6, 0.38, 0.04]} />
        <meshBasicMaterial toneMapped={false} />
        {seats.map((s) => (
          <Instance
            key={s.key}
            position={[s.x, 0.98, s.z + 0.28]}
            rotation={[0, s.facing, 0]}
            color={occupied.has(s.key) ? "#cfe3ff" : "#4a4d55"}
          />
        ))}
      </Instances>
    </>
  );
}
