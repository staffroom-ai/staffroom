/**
 * The office as a list.
 *
 * Not a fallback. A 3D scene is a poor way to answer "what is everyone doing"
 * with a screen reader, on a phone, or when you simply want the facts in a
 * column, so this is the same office said plainly. It is also what the smoke test
 * asserts against, because a test that drives a WebGL canvas tests the canvas.
 *
 * The data-testid and role contract below is shared with e2e/smoke.spec.ts and
 * is snapshot-tested, so renaming anything here fails loudly rather than
 * quietly breaking the only end-to-end check the project has.
 */
import type { Agent, BrainGraph, OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import { NotesTable } from "./NotesTable.js";

const STATUS_WORD: Record<string, string> = {
  idle: "Free",
  working: "Working",
  waiting_approval: "Needs you",
  error: "Stuck",
};

/** Text as well as the dot, so status is never carried by colour alone. */
function Status({ status }: { status: string }): ReactElement {
  return (
    <span className={`list-status list-status-${status}`}>
      <span className="list-dot" aria-hidden="true" />
      {STATUS_WORD[status] ?? status}
    </span>
  );
}

function timeOf(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Row({ agent, onOpen }: { agent: Agent; onOpen: (agentId: string) => void }): ReactElement {
  const name = agent.name ?? agent.id;

  return (
    <tr
      data-testid={`agent-${agent.id}`}
      data-state={agent.status}
      tabIndex={0}
      className="list-row"
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(agent.id);
      }}
      onClick={() => onOpen(agent.id)}
    >
      <th scope="row" className="list-name">
        {name}
      </th>
      <td>{agent.role}</td>
      <td>
        <Status status={agent.status} />
      </td>
      <td className="list-task">{agent.currentTask ?? "—"}</td>
      <td className="list-model">
        <span className="mono">{agent.model}</span>
        {agent.local && <span className="chip chip-local">local</span>}
      </td>
      <td className="list-tools">{agent.tools.length === 0 ? "—" : agent.tools.join(", ")}</td>
    </tr>
  );
}

export function ListView({
  state,
  graph,
  onOpenAgent,
  onOpenNote,
  onUpload,
  onRefuse,
}: {
  state: OfficeState;
  /** Undefined until the office has been asked for it. */
  graph?: BrainGraph | undefined;
  onOpenAgent: (agentId: string) => void;
  onOpenNote: (noteId: string) => void;
  onUpload?: ((file: File) => void) | undefined;
  onRefuse?: ((message: string) => void) | undefined;
}): ReactElement {
  const departments = [...state.departments].sort((a, b) => a.pod - b.pod);
  // A run nobody has picked up yet: it belongs to the office, not to a person.
  const queued = state.runs.filter((run) => run.agentId === null);

  return (
    <main className="list" id="list-view" tabIndex={-1}>
      <section aria-labelledby="latest-heading">
        <h2 id="latest-heading" className="list-heading">
          Latest results
        </h2>
        {state.latestDeliverables.length === 0 ? (
          <p className="list-empty">Nothing has been finished yet.</p>
        ) : (
          <ul className="list-results">
            {state.latestDeliverables.slice(0, 5).map((deliverable, index) => (
              <li key={deliverable.noteId}>
                <button
                  type="button"
                  className="list-result"
                  {...(index === 0 ? { "data-testid": "deliverable-latest" } : {})}
                  onClick={() => onOpenNote(deliverable.noteId)}
                >
                  {/* The accessible name has to begin "Written by <name>". */}
                  {`Written by ${deliverable.agentName ?? deliverable.agentId}: ${deliverable.title}`}
                  <span className="list-result-time">{timeOf(deliverable.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The brain, for anybody the picture does not serve. Not a fallback: on a
          narrow window this is the only view there is room for. */}
      {onUpload !== undefined && onRefuse !== undefined && (
        <NotesTable graph={graph} onOpenNote={onOpenNote} onUpload={onUpload} onRefuse={onRefuse} />
      )}

      {departments.map((department) => {
        const people = state.agents
          .filter((agent) => agent.departmentId === department.id)
          .sort((a, b) => a.seat - b.seat);
        const lead = state.agents.find((a) => a.id === department.leadAgentId);

        return (
          <section key={department.id} aria-labelledby={`dept-${department.id}`}>
            <h2 id={`dept-${department.id}`} className="list-heading">
              {department.name}
              {lead !== undefined && (
                <span className="list-lead">led by {lead.name ?? lead.id}</span>
              )}
            </h2>
            <table className="list-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Current task</th>
                  <th scope="col">Model</th>
                  <th scope="col">Connectors</th>
                </tr>
              </thead>
              <tbody>
                {people.map((agent) => (
                  <Row key={agent.id} agent={agent} onOpen={onOpenAgent} />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <section aria-labelledby="reception-heading">
        <h2 id="reception-heading" className="list-heading">
          Reception
        </h2>
        {queued.length === 0 ? (
          <p className="list-empty">Nothing is waiting to be picked up.</p>
        ) : (
          <ul className="list-queue">
            {queued.map((run) => (
              <li key={run.id}>
                {run.task}
                <span className="list-result-time">{timeOf(run.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export const VIEW_KEY = "staffroom.view";

/** Below this the list is the only view; a 3D office on a phone helps nobody. */
export const LIST_ONLY_BELOW = 768;
/** Above this the office is the default and the choice is not remembered. */
export const SCENE_DEFAULT_ABOVE = 1024;

export type View = "scene" | "list";

/**
 * Which view to show at a given width, given what the viewer chose before.
 * Narrow is forced, wide defaults to the office, and the band between them is
 * the only place the remembered preference applies.
 */
export function viewFor(width: number, remembered: string | null): View {
  if (width < LIST_ONLY_BELOW) return "list";
  if (width <= SCENE_DEFAULT_ABOVE && (remembered === "list" || remembered === "scene")) {
    return remembered;
  }
  return "scene";
}

/** Read the remembered choice without letting a blocked localStorage throw. */
export function rememberedView(): string | null {
  try {
    return window.localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

export function rememberView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A viewer with site data blocked simply does not get the memory.
  }
}

/**
 * What to announce, throttled so a busy office does not talk over itself.
 * One line per agent per five seconds: enough to follow, not enough to drown.
 */
export class Announcer {
  private readonly last = new Map<string, number>();
  private readonly everyMs: number;

  constructor(everyMs = 5_000) {
    this.everyMs = everyMs;
  }

  /** Returns the line to announce, or undefined if this agent spoke too recently. */
  consider(agentId: string, line: string, now: number): string | undefined {
    const previous = this.last.get(agentId);
    if (previous !== undefined && now - previous < this.everyMs) return undefined;
    this.last.set(agentId, now);
    return line;
  }
}
