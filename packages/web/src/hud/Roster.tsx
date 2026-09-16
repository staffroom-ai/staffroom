/**
 * Who works here.
 *
 * The old lower-left quadrant held nothing at all, which is a strange thing for an
 * office whose whole promise is "these named people work for you". Every agent is
 * named here, in floor order, with their role and one word saying what they are
 * doing. Two seconds on this list answers who is on staff and who is busy without
 * reading the scene at all.
 */
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import { podPencil } from "../scene/materials.js";

const STATE_WORD: Record<string, string> = {
  idle: "Free",
  working: "Working",
  waiting_approval: "Needs you",
  error: "Stuck",
};

const STATE_CLASS: Record<string, string> = {
  idle: "",
  working: " is-working",
  waiting_approval: " is-waiting",
  error: " is-error",
};

export function Roster({
  state,
  dark,
  selectedId,
  onSelect,
}: {
  state: OfficeState;
  dark: boolean;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}): ReactElement {
  const people = [...state.agents]
    .map((agent) => ({
      agent,
      pod: state.departments.find((d) => d.id === agent.departmentId)?.pod ?? 0,
    }))
    .sort((a, b) => (a.pod === b.pod ? a.agent.seat - b.agent.seat : a.pod - b.pod));

  const busy = people.filter((p) => p.agent.status !== "idle").length;
  const podCount = state.departments.length;

  return (
    <section className="panel roster" aria-label="Who works here">
      <div className="panel-head">
        <h2 className="panel-title">Staff</h2>
        <span className="panel-note">
          {busy} of {people.length} busy
        </span>
      </div>

      <div className="roster-list">
        {people.map(({ agent, pod }) => (
          <button
            key={agent.id}
            type="button"
            className={`person${selectedId === agent.id ? " is-selected" : ""}`}
            onClick={() => onSelect(agent.id)}
            aria-pressed={selectedId === agent.id}
            aria-label={`Talk to ${agent.name ?? agent.id}, ${agent.role}`}
          >
            <span
              className="person-pip"
              style={{ ["--pencil" as string]: podPencil(pod, dark, podCount) }}
              aria-hidden="true"
            />
            <span className="person-body">
              <span className="person-name">{agent.name ?? agent.id}</span>
              <span className="person-role">{agent.currentTask ?? agent.role}</span>
            </span>
            <span className={`person-state${STATE_CLASS[agent.status] ?? ""}`}>
              {STATE_WORD[agent.status] ?? "Free"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
