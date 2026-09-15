/**
 * The model: the table it sits on, the floor, the Brain and the six pods.
 *
 * Everything is matte card with soft shadows. The pods are annotated in coloured
 * pencil rather than painted in, which is what keeps six departments legible
 * without the office looking like a board game.
 */
import { Html, Instance, Instances } from "@react-three/drei";
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import {
  FLOOR_SIZE,
  POD_COUNT,
  podFacing,
  podPosition,
  seatPosition,
  seatsInPod,
} from "../layout.js";
import { podPencil, SURFACE_METALNESS, SURFACE_ROUGHNESS, surfaces } from "./materials.js";

const POD_RADIUS = 3.3;

/** The table the model sits on, and the card floor laid over it. */
export function Ground({ dark }: { dark: boolean }): ReactElement {
  const c = surfaces(dark);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_SIZE * 2.4, FLOOR_SIZE * 2.4]} />
        <meshStandardMaterial color={c.table} roughness={1} metalness={0} />
      </mesh>

      {/* A slab with thickness, so the floor has an edge and casts a shadow. */}
      <mesh position={[0, -0.16, 0]} receiveShadow castShadow>
        <boxGeometry args={[FLOOR_SIZE, 0.3, FLOOR_SIZE]} />
        <meshStandardMaterial
          color={c.floor}
          roughness={SURFACE_ROUGHNESS}
          metalness={SURFACE_METALNESS}
        />
      </mesh>
    </group>
  );
}

/** The Brain: a stack of cards, lit warm from within. */
export function Brain({ dark }: { dark: boolean }): ReactElement {
  const c = surfaces(dark);
  return (
    <group>
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.62, 0.32, 40]} />
        <meshStandardMaterial color={c.brain} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[1.18, 1.3, 0.22, 40]} />
        <meshStandardMaterial color={c.brain} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.82, 0.96, 0.18, 40]} />
        <meshStandardMaterial
          color={c.brain}
          roughness={0.7}
          metalness={0}
          emissive={dark ? "#6b6350" : "#ffffff"}
          emissiveIntensity={dark ? 0.35 : 0.22}
        />
      </mesh>
    </group>
  );
}

export function Pods({ state, dark }: { state: OfficeState; dark: boolean }): ReactElement {
  const used = new Set<number>(state.departments.map((d) => d.pod));

  return (
    <>
      {Array.from({ length: POD_COUNT }, (_, pod) => {
        const { x, z } = podPosition(pod);
        const department = state.departments.find((d) => (d.pod as number) === pod);
        const inUse = used.has(pod);
        const pencil = podPencil(pod, dark);

        return (
          <group key={`pod-at-${x}-${z}`} position={[x, 0, z]} rotation={[0, podFacing(pod), 0]}>
            {/* A ring rather than a filled disc: an annotation on the floor, not paint. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0.9]}>
              <ringGeometry args={[POD_RADIUS - 0.045, POD_RADIUS, 64]} />
              <meshBasicMaterial
                color={pencil}
                transparent
                opacity={inUse ? 0.85 : 0.22}
                toneMapped={false}
              />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0.9]}>
              <circleGeometry args={[POD_RADIUS, 64]} />
              <meshBasicMaterial
                color={pencil}
                transparent
                opacity={inUse ? 0.07 : 0.02}
                toneMapped={false}
              />
            </mesh>

            {department !== undefined && (
              <Html
                position={[0, 0.02, -POD_RADIUS + 0.4]}
                center
                zIndexRange={[8, 0]}
                occlude={false}
              >
                <span className="pod-label" style={{ color: pencil }}>
                  {department.name}
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/** Desks, chairs and monitors, instanced. */
export function Desks({ state, dark }: { state: OfficeState; dark: boolean }): ReactElement {
  const c = surfaces(dark);
  const seats: Array<{ key: string; x: number; z: number; facing: number }> = [];

  for (let pod = 0; pod < POD_COUNT; pod++) {
    for (let seat = 0; seat < seatsInPod(pod); seat++) {
      const { x, z } = seatPosition(pod, seat);
      seats.push({ key: `${pod}-${seat}`, x, z, facing: podFacing(pod) });
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
      <Instances limit={36} range={seats.length} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.07, 0.86]} />
        <meshStandardMaterial color={c.desk} roughness={SURFACE_ROUGHNESS} metalness={0} />
        {seats.map((s) => (
          <Instance key={s.key} position={[s.x, 0.7, s.z]} rotation={[0, s.facing, 0]} />
        ))}
      </Instances>

      {/* Two legs per desk, so it stands on the floor instead of hovering. */}
      <Instances limit={72} range={seats.length * 2} castShadow>
        <boxGeometry args={[0.07, 0.68, 0.07]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
        {seats.flatMap((s) => [
          <Instance
            key={`${s.key}-l`}
            position={[s.x - Math.cos(s.facing) * 0.62, 0.34, s.z - Math.sin(s.facing) * 0.62]}
          />,
          <Instance
            key={`${s.key}-r`}
            position={[s.x + Math.cos(s.facing) * 0.62, 0.34, s.z + Math.sin(s.facing) * 0.62]}
          />,
        ])}
      </Instances>

      <Instances limit={36} range={seats.length} castShadow>
        <boxGeometry args={[0.46, 0.06, 0.46]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
        {seats.map((s) => (
          <Instance
            key={s.key}
            position={[s.x - Math.sin(s.facing) * 1.0, 0.42, s.z - Math.cos(s.facing) * 1.0]}
            rotation={[0, s.facing, 0]}
          />
        ))}
      </Instances>

      <Instances limit={36} range={seats.length} castShadow>
        <boxGeometry args={[0.62, 0.36, 0.035]} />
        <meshStandardMaterial roughness={0.45} metalness={0} />
        {seats.map((s) => (
          <Instance
            key={s.key}
            position={[s.x + Math.sin(s.facing) * 0.3, 0.94, s.z + Math.cos(s.facing) * 0.3]}
            rotation={[-0.12, s.facing, 0]}
            color={occupied.has(s.key) ? c.screenOn : c.screenOff}
          />
        ))}
      </Instances>
    </>
  );
}
