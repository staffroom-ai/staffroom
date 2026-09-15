/**
 * One row per department, in the same order and the same colours as the floor.
 *
 * A row answers three things in the order they matter: which department, how many
 * people, and whether any of them is doing anything right now. The department's
 * pencil runs down the left edge as a full-height rule, which is what ties the row
 * to its wedge on the plate without a legend.
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

export function summarise(state: OfficeState, _dark: boolean): DepartmentSummary[] {
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
      style={{ ["--pencil" as string]: pencil }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${summary.name}: ${summary.agents} people, ${summary.working} working, ${summary.doneToday} filed`}
    >
      <span className="dept-edge" aria-hidden="true" />

      <span className="dept-body">
        <span className="dept-name">{summary.name}</span>
        <span className="dept-line">
          {summary.working > 0 ? <em>{summary.working} working</em> : "none working"}
          {summary.doneToday > 0 ? ` · ${summary.doneToday} filed` : ""}
        </span>
      </span>

      <span className="dept-figure">
        <span className="dept-figure-value">{summary.agents}</span>
        <span className="dept-figure-unit">{summary.agents === 1 ? "person" : "people"}</span>
      </span>

      {summary.waiting > 0 && <span className="dept-flag">{summary.waiting} waiting on you</span>}
    </button>
  );
}
