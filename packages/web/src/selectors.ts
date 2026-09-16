/**
 * Reading the office state the way the screen needs it.
 *
 * Kept separate from the store so each one can be tested against a plain snapshot,
 * with no React and no socket.
 */
import type { Agent, OfficeState, PendingApprovalView } from "@staffroom/core";
import { type Point, seatPosition } from "./layout.js";

export function agentsInPod(state: OfficeState, pod: number): Agent[] {
  const department = state.departments.find((d) => d.pod === pod);
  if (department === undefined) return [];
  return state.agents
    .filter((a) => a.departmentId === department.id)
    .sort((a, b) => a.seat - b.seat);
}

export function podOf(state: OfficeState, agentId: string): number | undefined {
  const agent = state.agents.find((a) => a.id === agentId);
  if (agent === undefined) return undefined;
  return state.departments.find((d) => d.id === agent.departmentId)?.pod;
}

export function positionOf(state: OfficeState, agentId: string): Point | undefined {
  const agent = state.agents.find((a) => a.id === agentId);
  const pod = podOf(state, agentId);
  if (agent === undefined || pod === undefined) return undefined;
  return seatPosition(pod, agent.seat, state.departments.length);
}

/** Pods with nobody in them render dimmed rather than being hidden. */
export function usedPods(state: OfficeState): number[] {
  return state.departments.map((d) => d.pod);
}

export function approvalsFor(state: OfficeState, agentId: string): PendingApprovalView[] {
  return state.approvals.filter((a) => a.agentId === agentId);
}

/** The one the approval chord acts on: oldest first, because it has waited longest. */
export function nextApproval(state: OfficeState): PendingApprovalView | undefined {
  return [...state.approvals].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
}

export function busyAgents(state: OfficeState): Agent[] {
  return state.agents.filter((a) => a.status === "working" || a.status === "waiting_approval");
}

/** `[` and `]` walk the office in pod then seat order. */
export function agentOrder(state: OfficeState): string[] {
  return [...state.agents]
    .sort((a, b) => {
      const podA = podOf(state, a.id) ?? 99;
      const podB = podOf(state, b.id) ?? 99;
      return podA === podB ? a.seat - b.seat : podA - podB;
    })
    .map((a) => a.id);
}

export function stepAgent(
  state: OfficeState,
  current: string | null,
  direction: 1 | -1,
): string | undefined {
  const order = agentOrder(state);
  if (order.length === 0) return undefined;
  const index = current === null ? -1 : order.indexOf(current);
  const next = (index + direction + order.length) % order.length;
  return order[next];
}

export function connectorPulse(state: OfficeState, connectorId: string): number {
  return state.connectors.find((c) => c.id === connectorId)?.pulse ?? 0;
}
