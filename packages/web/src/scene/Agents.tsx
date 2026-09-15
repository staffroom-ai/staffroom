/**
 * The people.
 *
 * Bodies are instanced capsules; heads carry the pod colour; a billboard above
 * each one shows status. Status colour is read from the office state every frame,
 * never from a cue, so the office can never show someone as working when they are
 * waiting.
 */

import { Instance, Instances } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { OfficeState } from "@staffroom/core";
import { type ReactElement, useMemo, useRef } from "react";
import { Color } from "three";
import { seatPosition } from "../layout.js";
import { useOfficeStore } from "../store.js";
import { podPencil, SURFACE_ROUGHNESS, statusColour } from "./materials.js";
import { AgentTimelines } from "./timeline.js";

const HEAD_HEIGHT = 1.3;
const BADGE_HEIGHT = 1.78;

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
  /**
   * One ref per body. drei's Instance forwards a node with its own position, which
   * is the supported way to move an instance; reaching into the parent's children
   * by index is not, and silently puts people in the wrong place.
   */
  const bodies = useRef<
    Array<{ position: { set: (x: number, y: number, z: number) => void } } | null>
  >([]);
  const timelines = useRef(new Map<string, AgentTimelines>());

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
        timeline = new AgentTimelines(seatPosition(person.pod, person.seat));
        timelines.current.set(cue.agentId, timeline);
      }
      if (reducedMotion && cue.kind !== "type_start" && cue.kind !== "type_stop") continue;
      timeline.push(cue, now, { x: 0, z: 0 });
    }

    placed.forEach((person, index) => {
      const seat = seatPosition(person.pod, person.seat);
      const motion = timelines.current.get(person.id)?.sample(now);
      const node = bodies.current[index];
      if (node === null || node === undefined) return;
      const at = motion?.position ?? seat;
      node.position.set(at.x, motion?.slumped === true ? 0.6 : 0.7, at.z);
    });
  });

  return (
    <>
      <Instances limit={35} range={placed.length} castShadow receiveShadow>
        <capsuleGeometry args={[0.27, 0.56, 8, 18]} />
        <meshStandardMaterial roughness={SURFACE_ROUGHNESS} metalness={0} />
        {placed.map((person, index) => {
          const seat = seatPosition(person.pod, person.seat);
          return (
            <Instance
              key={person.id}
              ref={(node: never) => {
                bodies.current[index] = node;
              }}
              position={[seat.x, 0.7, seat.z]}
              color={podPencil(person.pod, dark)}
            />
          );
        })}
      </Instances>

      <Instances limit={35} range={placed.length}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshToonMaterial />
        {placed.map((person) => {
          const seat = seatPosition(person.pod, person.seat);
          return (
            <Instance
              key={person.id}
              position={[seat.x, HEAD_HEIGHT, seat.z]}
              color={podPencil(person.pod, dark)}
            />
          );
        })}
      </Instances>

      {/* Status, straight from the office state. */}
      {/* Status, read from the office every frame rather than from a cue. */}
      <Instances limit={35} range={placed.length}>
        <sphereGeometry args={[0.1, 14, 12]} />
        <meshBasicMaterial toneMapped={false} />
        {placed.map((person) => {
          const seat = seatPosition(person.pod, person.seat);
          return (
            <Instance
              key={person.id}
              position={[seat.x, BADGE_HEIGHT, seat.z]}
              color={new Color(statusColour(person.status, dark))}
            />
          );
        })}
      </Instances>
    </>
  );
}
