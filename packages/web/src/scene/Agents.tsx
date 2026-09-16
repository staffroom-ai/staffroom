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
 */

import { useFrame } from "@react-three/fiber";
import type { OfficeState } from "@staffroom/core";
import { type ReactElement, useMemo, useRef } from "react";
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

interface Placed {
  id: string;
  pod: number;
  seat: number;
  status: OfficeState["agents"][number]["status"];
  local: boolean;
}

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
  /** One ref per person, so a walk moves the whole figure and its beacon together. */
  const figures = useRef<
    Array<{ position: { set: (x: number, y: number, z: number) => void } } | null>
  >([]);
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

    placed.forEach((person, index) => {
      const seat = seatPosition(person.pod, person.seat, podCount);
      const motion = timelines.current.get(person.id)?.sample(now);
      const node = figures.current[index];
      if (node === null || node === undefined) return;
      const at = motion?.position ?? seat;
      node.position.set(at.x, motion?.slumped === true ? -0.1 : 0, at.z);
    });
  });

  return (
    <>
      {placed.map((person, index) => {
        const seat = seatPosition(person.pod, person.seat, podCount);
        const status = statusColour(person.status, dark);
        const height = BEACON_HEIGHT[person.status] ?? IDLE_BEACON;
        const needsOwner = person.status === "waiting_approval";

        return (
          <group
            key={person.id}
            ref={(node: never) => {
              figures.current[index] = node;
            }}
            position={[seat.x, 0, seat.z]}
          >
            <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
              <capsuleGeometry args={[0.28, 0.54, 8, 20]} />
              <meshStandardMaterial color={c.figure} roughness={SURFACE_ROUGHNESS} metalness={0} />
            </mesh>
            <mesh position={[0, HEAD_HEIGHT, 0]} castShadow>
              <sphereGeometry args={[0.23, 18, 14]} />
              <meshStandardMaterial
                color={c.figureHead}
                roughness={SURFACE_ROUGHNESS}
                metalness={0}
              />
            </mesh>

            {/* The beacon: hue and height both say the same thing, twice. */}
            <mesh position={[0, BEACON_BASE + height / 2, 0]}>
              <boxGeometry args={[0.12, height, 0.12]} />
              <meshBasicMaterial color={status} toneMapped={false} />
            </mesh>

            {/* Only the state that needs a person gets a mark on the floor. */}
            {needsOwner && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <ringGeometry args={[0.72, 0.88, 40]} />
                <meshBasicMaterial color={status} toneMapped={false} transparent opacity={0.9} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}
