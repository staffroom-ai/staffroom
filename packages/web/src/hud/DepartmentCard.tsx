/**
 * A card per department, floating over its pod.
 *
 * This is what turns the model from a picture into an instrument. Each card
 * answers one question first, in one number, and only then offers detail. A card
 * that needs the owner says so in amber and says it loudly, because that is the
 * one thing on this screen they have to act on.
 */
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import { podPencil } from "../scene/materials.js";

export interface DepartmentSummary {
  id: string;
  name: string;
  pod: number;
  agents: number;
  working: number;
  waiting: number;
  doneToday: number;
}

export function summarise(state: OfficeState, dark: boolean): DepartmentSummary[] {
  return state.departments.map((department) => {
    const agents = state.agents.filter((a) => a.departmentId === department.id);
    return {
      id: department.id,
      name: department.name,
      pod: department.pod,
      agents: agents.length,
      working: agents.filter((a) => a.status === "working").length,
      waiting: state.approvals.filter((approval) => agents.some((a) => a.id === approval.agentId))
        .length,
      doneToday: state.latestDeliverables.filter((d) => d.departmentId === department.id).length,
      ...(dark ? {} : {}),
    };
  });
}

export function DepartmentCard({
  summary,
  dark,
  selected,
  onSelect,
}: {
  summary: DepartmentSummary;
  dark: boolean;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  const pencil = podPencil(summary.pod, dark);

  return (
    <button
      type="button"
      className={`dept-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-label={`${summary.name}: ${summary.agents} people, ${summary.working} working`}
    >
      <span className="dept-card-head">
        <span className="dept-dot" style={{ background: pencil }} />
        <span className="dept-name">{summary.name}</span>
      </span>

      {/* The one number the card is about. */}
      <span className="dept-figure">
        <span className="dept-figure-value">{summary.agents}</span>
        <span className="dept-figure-unit">{summary.agents === 1 ? "person" : "people"}</span>
      </span>

      <span className="dept-stats">
        <span className="dept-stat">
          <span className="dept-stat-label">Working</span>
          <span className="dept-stat-value">{summary.working}</span>
        </span>
        <span className="dept-stat">
          <span className="dept-stat-label">Filed</span>
          <span className="dept-stat-value">{summary.doneToday}</span>
        </span>
      </span>

      {summary.waiting > 0 && (
        <span className="dept-waiting">{summary.waiting} waiting on you</span>
      )}
    </button>
  );
}
