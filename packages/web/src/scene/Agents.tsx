/**
 * The people.
 *
 * A person is a neutral figure: dark on a light floor, light on a dark one, so
 * the silhouette is the strongest thing on the plate. They carry no department
 * colour — the floor already says which team they are on — and exactly one piece
 * of colour, which is the beacon above them saying what they are doing.
 *
 * Idle is a small dim marker. Working is a green bar. Waiting on the owner is a
 * taller amber bar with a ring on the floor, because that is the only state that
 * needs a human. Status is read from the office state every frame, never from a
 * cue, so the office can never show someone as working when they are waiting.
 *
 * Drawn as four instanced meshes rather than four meshes per person. The perf
 * test measured the old shape at 23 draw calls each — every body, head, beacon
 * and ring was its own object, and the shadow pass drew most of them twice — so
 * a room of thirty-five cost hundreds of calls for what is visibly the same
 * figure over and over. Instanced, the whole room costs the same handful of
 * calls whether it holds four people or forty, which is what makes the office
 * something you can leave open all day.
 *
 * Clicking is unaffected: picking.ts was already screen-space rectangles rather
 * than raycasting, written for exactly this.
 */

import { useFrame } from "@react-three/fiber";
import type { OfficeState } from "@staffroom/core";
import { type ReactElement, useLayoutEffect, useMemo, useRef } from "react";
import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { seatPosition } from "../layout.js";
import { useOfficeStore } from "../store.js";
import { SURFACE_ROUGHNESS, statusColour, surfaces } from "./materials.js";
import { AgentTimelines } from "./timeline.js";

const HEAD_HEIGHT = 1.28;
const BEACON_BASE = 1.62;

/** How tall the beacon stands, by status. Height is the second channel after hue. */
const IDLE_BEACON = 0.12;
const BEACON_HEIGHT: Record<string, number> = {
  idle: IDLE_BEACON,
  working: 0.46,
  waiting_approval: 0.78,
  error: 0.6,
};

/**
 * How many people the instanced meshes are built for.
 *
 * Fixed at mount, because growing an InstancedMesh means rebuilding its buffers
 * and an office does not gain staff mid-frame. Comfortably past any small
 * business, and the unused slots cost nothing: the draw count is the roster,
 * so the GPU never sees them.
 */
const MAX_AGENTS = 64;

interface Placed {
  id: string;
  pod: number;
  seat: number;
  status: OfficeState["agents"][number]["status"];
  local: boolean;
}

/** Scratch objects, reused every frame so the loop allocates nothing. */
const MATRIX = new Matrix4();
const POSITION = new Vector3();
const SCALE = new Vector3(1, 1, 1);
const UPRIGHT = new Quaternion();
/** The ring lies on the floor; a plane geometry stands up unless it is turned. */
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

export function Agents({
  state,
  reducedMotion,
  dark,
}: {
  state: OfficeState;
  reducedMotion: boolean;
  dark: boolean;
}): ReactElement {
  const c = surfaces(dark);
  const bodies = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const beacons = useRef<InstancedMesh>(null);
  const rings = useRef<InstancedMesh>(null);
  const timelines = useRef(new Map<string, AgentTimelines>());
  /** The floor is divided by the number of departments, so seats move with it. */
  const podCount = state.departments.length;

  const placed: Placed[] = useMemo(
    () =>
      state.agents.map((agent) => ({
        id: agent.id,
        pod: state.departments.find((d) => d.id === agent.departmentId)?.pod ?? 0,
        seat: agent.seat,
        status: agent.status,
        local: agent.local,
      })),
    [state.agents, state.departments],
  );

  /*
   * Nothing is drawn until the frame loop has placed it.
   *
   * An InstancedMesh starts with identity matrices and a full count, so without
   * this the first painted frame would be sixty-four figures stacked on the
   * origin. The loop below sets the real count immediately afterwards.
   */
  useLayoutEffect(() => {
    for (const mesh of [bodies.current, heads.current, beacons.current, rings.current]) {
      if (mesh !== null) mesh.count = 0;
    }
  }, []);

  useFrame(() => {
    const now = performance.now();
    // Cues are taken once; leaving them would replay every frame.
    const cues = useOfficeStore.getState().drainAnimations();

    for (const cue of cues) {
      const person = placed.find((p) => p.id === cue.agentId);
      if (person === undefined) continue;
      let timeline = timelines.current.get(cue.agentId);
      if (timeline === undefined) {
        timeline = new AgentTimelines(seatPosition(person.pod, person.seat, podCount));
        timelines.current.set(cue.agentId, timeline);
      }
      if (reducedMotion && cue.kind !== "type_start" && cue.kind !== "type_stop") continue;
      timeline.push(cue, now, { x: 0, z: 0 });
    }

    const body = bodies.current;
    const head = heads.current;
    const beacon = beacons.current;
    const ring = rings.current;
    if (body === null || head === null || beacon === null || ring === null) return;

    const drawn = Math.min(placed.length, MAX_AGENTS);
    let ringCount = 0;

    for (let i = 0; i < drawn; i++) {
      const person = placed[i] as Placed;
      const seat = seatPosition(person.pod, person.seat, podCount);
      const motion = timelines.current.get(person.id)?.sample(now);
      const at = motion?.position ?? seat;
      // Slumping drops the whole figure, exactly as moving the group used to.
      const y = motion?.slumped === true ? -0.1 : 0;

      SCALE.set(1, 1, 1);
      POSITION.set(at.x, y + 0.72, at.z);
      body.setMatrixAt(i, MATRIX.compose(POSITION, UPRIGHT, SCALE));

      POSITION.set(at.x, y + HEAD_HEIGHT, at.z);
      head.setMatrixAt(i, MATRIX.compose(POSITION, UPRIGHT, SCALE));

      // One unit-height box scaled per person, so the beacon still says the same
      // thing twice — hue and height — out of a single shared geometry.
      const height = BEACON_HEIGHT[person.status] ?? IDLE_BEACON;
      POSITION.set(at.x, y + BEACON_BASE + height / 2, at.z);
      SCALE.set(1, height, 1);
      beacon.setMatrixAt(i, MATRIX.compose(POSITION, UPRIGHT, SCALE));
      beacon.setColorAt(i, statusColour(person.status, dark));

      if (person.status === "waiting_approval") {
        SCALE.set(1, 1, 1);
        POSITION.set(at.x, y + 0.02, at.z);
        ring.setMatrixAt(ringCount, MATRIX.compose(POSITION, FLAT, SCALE));
        ring.setColorAt(ringCount, statusColour(person.status, dark));
        ringCount += 1;
      }
    }

    /*
     * The count is the roster, not the buffer.
     *
     * Spare slots are never drawn rather than drawn at zero size: the GPU would
     * still transform and count their triangles, which is how you end up with a
     * scene that is cheap in draw calls and expensive anyway. It also means an
     * agent removed from agents.yaml stops being in the room on the next frame.
     */
    body.count = drawn;
    head.count = drawn;
    beacon.count = drawn;
    // And a ring only for the people actually waiting, because it is the one
    // mark in the office that means "this needs you".
    ring.count = ringCount;

    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    beacon.instanceMatrix.needsUpdate = true;
    ring.instanceMatrix.needsUpdate = true;
    if (beacon.instanceColor !== null) beacon.instanceColor.needsUpdate = true;
    if (ring.instanceColor !== null) ring.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh
        ref={bodies}
        args={[undefined, undefined, MAX_AGENTS]}
        castShadow
        receiveShadow
        /*
         * The bounding sphere three computes is around the geometry at the
         * origin, not around where the instances actually are, so culling it
         * per-mesh would blink the whole staff out at the wrong moment.
         */
        frustumCulled={false}
      >
        <capsuleGeometry args={[0.28, 0.54, 8, 20]} />
        <meshStandardMaterial color={c.figure} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </instancedMesh>

      <instancedMesh
        ref={heads}
        args={[undefined, undefined, MAX_AGENTS]}
        castShadow
        frustumCulled={false}
      >
        <sphereGeometry args={[0.23, 18, 14]} />
        <meshStandardMaterial color={c.figureHead} roughness={SURFACE_ROUGHNESS} metalness={0} />
      </instancedMesh>

      {/* A unit-height box: the per-person height is the instance scale. */}
      <instancedMesh ref={beacons} args={[undefined, undefined, MAX_AGENTS]} frustumCulled={false}>
        <boxGeometry args={[0.12, 1, 0.12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Only the state that needs a person gets a mark on the floor. */}
      <instancedMesh ref={rings} args={[undefined, undefined, MAX_AGENTS]} frustumCulled={false}>
        <ringGeometry args={[0.72, 0.88, 40]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.9} />
      </instancedMesh>
    </>
  );
}
