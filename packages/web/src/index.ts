/**
 * @staffroom/web — the office in the browser.
 *
 * A render layer over one OfficeState. Everything exported here is the part that
 * can be tested without a WebGL context.
 */

export type { ActivityLine, AnimationCue, CueKind, IngestOptions } from "./cues.js";
export { dedupeCues, ingestEvent } from "./cues.js";
export type { Binding } from "./keymap.js";
export { bindingFor, chordFor, groups, KEYMAP } from "./keymap.js";
export type { Point } from "./layout.js";
export {
  BRAIN_POSITION,
  distanceOf,
  FLOOR_SIZE,
  POD_COLOURS,
  POD_COUNT,
  POD_RING_RADIUS,
  pathBetween,
  podColour,
  podFacing,
  podPosition,
  pointAlong,
  RECEPTION_POD,
  SEATS_PER_POD,
  seatPosition,
  seatsInPod,
} from "./layout.js";
export type { ClientMessage, ServerMessage } from "./protocol.js";
export {
  agentOrder,
  agentsInPod,
  approvalsFor,
  busyAgents,
  connectorPulse,
  nextApproval,
  podOf,
  positionOf,
  stepAgent,
  usedPods,
} from "./selectors.js";
export type { ChatTurn, OfficeStore } from "./store.js";
export { useOfficeStore } from "./store.js";
export type { Connection, SocketOptions } from "./ws.js";
export { backoffFor, OfficeSocket, readToken } from "./ws.js";
