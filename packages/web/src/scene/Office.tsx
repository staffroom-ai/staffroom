/**
 * The model: the floorplate, the department wedges, the Brain and the desks.
 *
 * The scene is the primary display of state, not decoration, so every shape here
 * is carrying information:
 *
 *   the plate       one lit surface, clear of the ground, so the office is an object
 *   the wedges      which six departments exist and where they sit
 *   the desk        a silhouette you can name at a glance: top, screen, chair, tray
 *   the screen      lit when that person is working, dark when they are not
 *   the pool        a disc of status light under anyone mid-task
 *   the tray        a sheet of paper for every finished piece of work
 */
import { Html } from "@react-three/drei";
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import { podFacing, podPosition, seatPosition } from "../layout.js";
import {
  accent,
  podPencil,
  SURFACE_METALNESS,
  SURFACE_ROUGHNESS,
  statusColour,
  surfaces,
} from "./materials.js";

/** The plate is round because the office is a ring of six; a square left dead corners. */
/** The plate hugs the pod ring; a wider one left a bare margin all round. */
export const PLATE_RADIUS = 11.4;
const PLATE_THICKNESS = 0.7;
const WEDGE_INNER = 3.4;
const WEDGE_OUTER = 10.6;

/** Local frame of a workstation: +Z points at the Brain, so everyone faces the middle. */
const DESK_OFFSET = 0.66;

/** Named sheets, so a stack of paper does not key off its own index. */
const SHEETS = ["a", "b", "c", "d", "e", "f"] as const;

/**
 * The floorplate.
 *
 * There is deliberately nothing behind it: the old full-bleed table plane was the
 * same value as the plate and as the page, which is why the office read as one
 * undifferentiated field with a stray diamond bleeding off the top of the frame.
 */
export function Ground({ dark }: { dark: boolean }): ReactElement {
  const c = surfaces(dark);
  return (
    <group>
      {/* The slab, with a visible rim so the plate has thickness and an edge. */}
      <mesh position={[0, -PLATE_THICKNESS / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[PLATE_RADIUS, PLATE_RADIUS - 0.12, PLATE_THICKNESS, 96]} />
        <meshStandardMaterial
          color={c.floorEdge}
          roughness={SURFACE_ROUGHNESS}
          metalness={SURFACE_METALNESS}
        />
      </mesh>

      {/* The walking surface, a hair above the slab so the rim always reads. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <circleGeometry args={[PLATE_RADIUS - 0.16, 96]} />
        <meshStandardMaterial color={c.floor} roughness={0.96} metalness={0} />
      </mesh>
    </group>
  );
}

/**
 * The Brain: the shared memory every agent reads from and writes to.
 *
 * It is the only place in the model that carries the accent, and the only thing
 * that emits light, which is what makes the centre of the plate read as the source
 * of the office rather than as an unexplained white puck.
 */
export function Brain({ dark }: { dark: boolean }): ReactElement {
  const c = surfaces(dark);
  const glow = accent(dark);
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.1, 2.3, 0.6, 6]} />
        <meshStandardMaterial color={c.brain} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      {/* A second, smaller course of the same stack: the memory, stacked up. */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.32, 1.5, 0.26, 6]} />
        <meshStandardMaterial color={c.brain} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      {/* One hairline of accent around the top course. Nothing else glows. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.855, 0]}>
        <ringGeometry args={[1.12, 1.3, 6]} />
        <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      <pointLight position={[0, 1.2, 0]} intensity={dark ? 2.6 : 1.1} distance={5.5} color={glow} />

      {/* Named, because an unexplained shape in the middle of the floor is a bug. */}
      <Html position={[0, 1.05, 0]} center zIndexRange={[8, 0]} occlude={false}>
        <span className="plate-label">Brain</span>
      </Html>
    </group>
  );
}

/**
 * The department wedges.
 *
 * Six sectors of the plate, one per department, tinted in that department's pencil
 * and edged in a solid band of it. This is what makes "who works here" a one-glance
 * question: the floor itself is the org chart.
 */
export function Pods({
  state,
  dark,
  labels = true,
}: {
  state: OfficeState;
  dark: boolean;
  labels?: boolean;
}): ReactElement {
  return (
    <>
      {state.departments.map((department) => {
        const pod = department.pod as number;
        const podCount = state.departments.length;
        const a = podFacing(pod, podCount);
        const inUse = true;
        const pencil = podPencil(pod, dark, podCount);
        // The plane is rotated flat, so a pod's world bearing becomes this angle.
        const start = Math.PI / 2 - a - Math.PI / podCount;
        const sweep = (Math.PI * 2) / podCount - 0.016;
        const outward = podPosition(pod, podCount);
        const unit = Math.hypot(outward.x, outward.z) || 1;

        return (
          <group key={department?.id ?? `empty-pod-${podPosition(pod).x}-${podPosition(pod).z}`}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
              <ringGeometry args={[WEDGE_INNER, WEDGE_OUTER, 48, 1, start, sweep]} />
              <meshBasicMaterial
                color={pencil}
                transparent
                opacity={inUse ? (dark ? 0.1 : 0.17) : 0.04}
                toneMapped={false}
              />
            </mesh>

            {/* A band at the outer edge: the department's colour, unmistakable. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
              <ringGeometry args={[WEDGE_OUTER, WEDGE_OUTER + 0.42, 48, 1, start, sweep]} />
              <meshBasicMaterial
                color={pencil}
                transparent
                opacity={inUse ? 0.95 : 0.18}
                toneMapped={false}
              />
            </mesh>

            {labels && (
              <Html
                position={[
                  (outward.x / unit) * (WEDGE_OUTER - 3.4),
                  0.02,
                  (outward.z / unit) * (WEDGE_OUTER - 3.4),
                ]}
                center
                zIndexRange={[8, 0]}
                occlude={false}
              >
                <span className="pod-label" style={{ ["--pencil" as string]: pencil }}>
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

interface SeatState {
  key: string;
  pod: number;
  seat: number;
  status: "idle" | "working" | "waiting_approval" | "error" | undefined;
  filed: number;
}

/**
 * One workstation: desk, modesty panel, legs, monitor, chair and out-tray.
 *
 * Every part is a different height and a different value, because a desk made of
 * one flat box at one tone is what made the old office read as a field of blobs.
 */
function Workstation({
  seat,
  dark,
  podCount,
}: {
  seat: SeatState;
  dark: boolean;
  podCount: number;
}): ReactElement {
  const c = surfaces(dark);
  const at = seatPosition(seat.pod, seat.seat, podCount);
  // layout.ts rotates anticlockwise in (x,z); three rotates the other way, so the
  // group turns by -facing and local +Z then points at the Brain.
  const facing = -podFacing(seat.pod);
  const lit = seat.status === "working" || seat.status === "waiting_approval";
  const status = statusColour(seat.status ?? "idle", dark);

  return (
    <group position={[at.x, 0, at.z]} rotation={[0, facing, 0]}>
      {/* Desk top */}
      <mesh position={[0, 0.74, DESK_OFFSET]} castShadow receiveShadow>
        <boxGeometry args={[1.74, 0.08, 0.94]} />
        <meshStandardMaterial color={c.desk} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      {/* Modesty panel: the piece that reads as "desk" from across the room. */}
      <mesh position={[0, 0.44, DESK_OFFSET + 0.44]} castShadow>
        <boxGeometry args={[1.72, 0.54, 0.07]} />
        <meshStandardMaterial color={c.deskEdge} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      <mesh position={[-0.82, 0.37, DESK_OFFSET]} castShadow>
        <boxGeometry args={[0.08, 0.74, 0.86]} />
        <meshStandardMaterial color={c.deskEdge} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      <mesh position={[0.82, 0.37, DESK_OFFSET]} castShadow>
        <boxGeometry args={[0.08, 0.74, 0.86]} />
        <meshStandardMaterial color={c.deskEdge} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>

      {/* Monitor: stand, then a panel that lights up when this person is working. */}
      <mesh position={[0.02, 0.86, DESK_OFFSET + 0.3]} castShadow>
        <boxGeometry args={[0.1, 0.18, 0.1]} />
        <meshStandardMaterial color={c.chair} roughness={0.7} metalness={0} />
      </mesh>
      <mesh
        position={[0.02, 1.19, DESK_OFFSET + 0.31]}
        rotation={[0.16, 0, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.86, 0.5, 0.05]} />
        <meshStandardMaterial
          color={lit ? c.screenOn : c.screenOff}
          roughness={0.4}
          metalness={0}
          emissive={lit ? status : "#000000"}
          emissiveIntensity={lit ? (dark ? 0.9 : 0.5) : 0}
        />
      </mesh>

      {/* Chair: seat and a back, so a person is clearly sitting at something. */}
      <mesh position={[0, 0.46, -0.44]} castShadow>
        <boxGeometry args={[0.56, 0.09, 0.56]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      <mesh position={[0, 0.76, -0.7]} rotation={[-0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.56, 0.52, 0.08]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>
      <mesh position={[0, 0.21, -0.44]} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 0.42, 10]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </mesh>

      {/* The out-tray: one sheet per finished piece of work. */}
      {SHEETS.slice(0, Math.min(seat.filed, 6)).map((sheet, i) => (
        <mesh
          key={`sheet-${seat.key}-${sheet}`}
          position={[0.58, 0.81 + i * 0.05, DESK_OFFSET - 0.2]}
          rotation={[0, 0.12, 0]}
          castShadow
        >
          <boxGeometry args={[0.5, 0.05, 0.4]} />
          <meshStandardMaterial color={c.paper} roughness={0.85} metalness={0} />
        </mesh>
      ))}

      {/* A pool of status light on the floor: busy is visible from anywhere. */}
      {lit && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0.2]}>
          <circleGeometry args={[1.5, 40]} />
          <meshBasicMaterial
            color={status}
            transparent
            opacity={dark ? 0.24 : 0.16}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

/** Every desk in the office, occupied or not. */
export function Desks({ state, dark }: { state: OfficeState; dark: boolean }): ReactElement {
  // A desk per person, not a desk per seat the floor plan could hold. Rendering
  // all 35 seats made a four-person studio read as an abandoned office, and it
  // also made the scene disagree with the roster panel, which counts people.
  const podCount = state.departments.length;
  const seats: SeatState[] = [];

  for (const agent of state.agents) {
    const pod = state.departments.find((d) => d.id === agent.departmentId)?.pod;
    if (pod === undefined) continue;
    seats.push({
      key: `${pod}-${agent.seat}`,
      pod,
      seat: agent.seat,
      status: agent.status,
      filed: state.latestDeliverables.filter((d) => d.agentId === agent.id).length,
    });
  }

  return (
    <>
      {seats.map((seat) => (
        <Workstation key={seat.key} seat={seat} dark={dark} podCount={podCount} />
      ))}
    </>
  );
}
