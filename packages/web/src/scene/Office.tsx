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
import { type ReactElement, type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { type Color, Euler, type InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
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
type Status = "idle" | "working" | "waiting_approval" | "error";

interface SeatState {
  key: string;
  pod: number;
  seat: number;
  status: Status | undefined;
  filed: number;
}

/**
 * How many workstations the instanced buffers are built for.
 *
 * Fixed at mount, because an InstancedMesh's buffers are sized once and a room
 * does not gain desks mid-frame. Past any small business; the spare slots are
 * never drawn, because the count is set from the roster.
 */
const MAX_SEATS = 64;

/** Six is as many sheets as the tray holds before it stops reading as a stack. */
const MAX_SHEETS = 6;

const NO_SCALE = new Vector3(1, 1, 1);

/** A fixed offset inside a workstation's own frame. */
function local(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    NO_SCALE,
  );
}

/**
 * One workstation, as offsets rather than as meshes.
 *
 * Every part is a different height and a different value, because a desk made of
 * one flat box at one tone is what made the old office read as a field of blobs.
 * They are listed here once and then stamped out per person: the shapes are
 * identical from desk to desk, so there is no reason for the GPU to be told
 * about them thirty-five times over.
 */
const PART = {
  top: local([0, 0.74, DESK_OFFSET]),
  modesty: local([0, 0.44, DESK_OFFSET + 0.44]),
  legLeft: local([-0.82, 0.37, DESK_OFFSET]),
  legRight: local([0.82, 0.37, DESK_OFFSET]),
  stand: local([0.02, 0.86, DESK_OFFSET + 0.3]),
  screen: local([0.02, 1.19, DESK_OFFSET + 0.31], [0.16, 0, 0]),
  chairSeat: local([0, 0.46, -0.44]),
  chairBack: local([0, 0.76, -0.7], [-0.1, 0, 0]),
  chairPost: local([0, 0.21, -0.44]),
  pool: local([0, 0.014, 0.2], [-Math.PI / 2, 0, 0]),
} as const;

const SHEET_AT = Array.from({ length: MAX_SHEETS }, (_, i) =>
  local([0.58, 0.81 + i * 0.05, DESK_OFFSET - 0.2], [0, 0.12, 0]),
);

/** Whether this person's screen is lit, which is the one thing a desk animates. */
function isLit(status: Status | undefined): boolean {
  return status === "working" || status === "waiting_approval";
}

interface Placement {
  top: Matrix4[];
  modesty: Matrix4[];
  legs: Matrix4[];
  stand: Matrix4[];
  chairSeat: Matrix4[];
  chairBack: Matrix4[];
  chairPost: Matrix4[];
  sheets: Matrix4[];
  pools: Matrix4[];
  poolStatus: Status[];
  /** Screens split by what they are showing; the material differs, so the mesh must. */
  screensOff: Matrix4[];
  screensWorking: Matrix4[];
  screensWaiting: Matrix4[];
}

/**
 * Every part of every desk, in world space.
 *
 * Worked out once per roster change rather than per frame: desks do not move,
 * and the only thing about them that changes between frames is whether a screen
 * is lit, which is a change of which list a matrix is in.
 */
function placeDesks(seats: SeatState[], podCount: number): Placement {
  const out: Placement = {
    top: [],
    modesty: [],
    legs: [],
    stand: [],
    chairSeat: [],
    chairBack: [],
    chairPost: [],
    sheets: [],
    pools: [],
    poolStatus: [],
    screensOff: [],
    screensWorking: [],
    screensWaiting: [],
  };

  for (const seat of seats.slice(0, MAX_SEATS)) {
    const at = seatPosition(seat.pod, seat.seat, podCount);
    // layout.ts rotates anticlockwise in (x,z); three rotates the other way, so
    // the frame turns by -facing and local +Z then points at the Brain.
    const frame = new Matrix4().makeRotationY(-podFacing(seat.pod, podCount));
    frame.setPosition(at.x, 0, at.z);
    const world = (part: Matrix4): Matrix4 => new Matrix4().multiplyMatrices(frame, part);

    out.top.push(world(PART.top));
    out.modesty.push(world(PART.modesty));
    out.legs.push(world(PART.legLeft), world(PART.legRight));
    out.stand.push(world(PART.stand));
    out.chairSeat.push(world(PART.chairSeat));
    out.chairBack.push(world(PART.chairBack));
    out.chairPost.push(world(PART.chairPost));

    const screen = world(PART.screen);
    if (seat.status === "working") out.screensWorking.push(screen);
    else if (seat.status === "waiting_approval") out.screensWaiting.push(screen);
    else out.screensOff.push(screen);

    // The out-tray: one sheet per finished piece of work.
    for (let i = 0; i < Math.min(seat.filed, MAX_SHEETS); i++) {
      out.sheets.push(world(SHEET_AT[i] as Matrix4));
    }

    // A pool of status light on the floor: busy is visible from anywhere.
    if (isLit(seat.status)) {
      out.pools.push(world(PART.pool));
      out.poolStatus.push(seat.status ?? "idle");
    }
  }

  return out;
}

/**
 * One instanced part, placed.
 *
 * Frustum culling is off because three works the bounding sphere out from the
 * geometry sitting at the origin rather than from where the instances actually
 * are, and a desk that vanishes when the camera pans is worse than a desk that
 * is always considered.
 */
function Part({
  at,
  colours,
  castShadow = false,
  receiveShadow = false,
  children,
}: {
  at: Matrix4[];
  colours?: Color[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  children: ReactNode;
}): ReactElement {
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const node = mesh.current;
    if (node === null) return;
    const drawn = Math.min(at.length, node.instanceMatrix.count);
    for (let i = 0; i < drawn; i++) node.setMatrixAt(i, at[i] as Matrix4);
    if (colours !== undefined) {
      for (let i = 0; i < drawn; i++) node.setColorAt(i, colours[i] as Color);
    }
    // The count is the roster, not the buffer: spare slots are never drawn, so
    // the GPU is never asked to transform triangles nobody can see.
    node.count = drawn;
    node.instanceMatrix.needsUpdate = true;
    if (node.instanceColor !== null) node.instanceColor.needsUpdate = true;
  }, [at, colours]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, MAX_SEATS * MAX_SHEETS]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    >
      {children}
    </instancedMesh>
  );
}

/**
 * Every desk in the office, occupied or not.
 *
 * Ten meshes per person is what the perf test caught: thirty-five people meant
 * hundreds of draw calls for ten shapes repeated over and over, most of them
 * drawn twice because they cast shadows. Instanced, the whole room of desks is a
 * dozen calls whether it seats four people or forty.
 */
export function Desks({ state, dark }: { state: OfficeState; dark: boolean }): ReactElement {
  const c = surfaces(dark);
  // A desk per person, not a desk per seat the floor plan could hold. Rendering
  // all 35 seats made a four-person studio read as an abandoned office, and it
  // also made the scene disagree with the roster panel, which counts people.
  const podCount = state.departments.length;

  const placement = useMemo(() => {
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
    return placeDesks(seats, podCount);
  }, [state.agents, state.departments, state.latestDeliverables, podCount]);

  const poolColours = useMemo(
    () => placement.poolStatus.map((status) => statusColour(status, dark)),
    [placement.poolStatus, dark],
  );

  const working = statusColour("working", dark);
  const waiting = statusColour("waiting_approval", dark);

  return (
    <>
      {/* Desk top */}
      <Part at={placement.top} castShadow receiveShadow>
        <boxGeometry args={[1.74, 0.08, 0.94]} />
        <meshStandardMaterial color={c.desk} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </Part>

      {/* Modesty panel: the piece that reads as "desk" from across the room. */}
      <Part at={placement.modesty} castShadow>
        <boxGeometry args={[1.72, 0.54, 0.07]} />
        <meshStandardMaterial color={c.deskEdge} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </Part>

      {/* Both legs of every desk out of one mesh: same shape, mirrored across. */}
      <Part at={placement.legs} castShadow>
        <boxGeometry args={[0.08, 0.74, 0.86]} />
        <meshStandardMaterial color={c.deskEdge} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </Part>

      {/* Monitor stand. */}
      <Part at={placement.stand} castShadow>
        <boxGeometry args={[0.1, 0.18, 0.1]} />
        <meshStandardMaterial color={c.chair} roughness={0.7} metalness={0} />
      </Part>

      {/*
        Screens, in three meshes rather than one.

        An instance can carry its own colour but not its own glow, and the glow
        is the point: a lit screen is how you see from across the room that
        somebody is mid-task. So the desks are sorted by what their screen is
        showing, and each group gets the material for it. There are only ever
        three groups, however many people are in the office.
      */}
      <Part at={placement.screensOff} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.5, 0.05]} />
        <meshStandardMaterial
          color={c.screenOff}
          roughness={0.4}
          metalness={0}
          emissive="#000000"
          emissiveIntensity={0}
        />
      </Part>
      <Part at={placement.screensWorking} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.5, 0.05]} />
        <meshStandardMaterial
          color={c.screenOn}
          roughness={0.4}
          metalness={0}
          emissive={working}
          emissiveIntensity={dark ? 0.9 : 0.5}
        />
      </Part>
      <Part at={placement.screensWaiting} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.5, 0.05]} />
        <meshStandardMaterial
          color={c.screenOn}
          roughness={0.4}
          metalness={0}
          emissive={waiting}
          emissiveIntensity={dark ? 0.9 : 0.5}
        />
      </Part>

      {/* Chair: seat and a back, so a person is clearly sitting at something. */}
      <Part at={placement.chairSeat} castShadow>
        <boxGeometry args={[0.56, 0.09, 0.56]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </Part>
      <Part at={placement.chairBack} castShadow>
        <boxGeometry args={[0.56, 0.52, 0.08]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </Part>
      <Part at={placement.chairPost} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 0.42, 10]} />
        <meshStandardMaterial color={c.chair} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </Part>

      {/* The out-tray: one sheet per finished piece of work, all trays at once. */}
      <Part at={placement.sheets} castShadow>
        <boxGeometry args={[0.5, 0.05, 0.4]} />
        <meshStandardMaterial color={c.paper} roughness={0.85} metalness={0} />
      </Part>

      {/*
        The pools of status light. Unlit material, so here the instance colour
        does carry the status and one mesh covers every busy desk.
      */}
      <Part at={placement.pools} colours={poolColours}>
        <circleGeometry args={[1.5, 40]} />
        <meshBasicMaterial transparent opacity={dark ? 0.24 : 0.16} toneMapped={false} />
      </Part>
    </>
  );
}
