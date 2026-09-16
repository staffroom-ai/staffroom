/**
 * What the office does without being asked, and how to stop it.
 *
 * Unattended work is the one part of this product that happens while nobody is
 * looking, so the list exists as much to be turned off as to be read. Pause, run
 * now and delete are all one click from here — nobody should have to open a YAML
 * file to stop something that is sending email every morning.
 *
 * Delete asks first. It is the one action here that cannot be undone from this
 * screen, and a routine somebody spent a minute describing is not worth losing
 * to a misplaced click.
 */
import type { RoutineView } from "@staffroom/core";
import { type ReactElement, useState } from "react";
import { describeRoutine, nextRunText } from "./schedule.js";

export interface RoutinesProps {
  routines: RoutineView[];
  onPause: (id: string, paused: boolean) => void;
  onRunNow: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Routines({ routines, onPause, onRunNow, onDelete }: RoutinesProps): ReactElement {
  const [confirming, setConfirming] = useState<string | undefined>(undefined);

  if (routines.length === 0) {
    return (
      <p className="routines-empty">
        Nothing runs on its own yet. Pick a time beside the task bar to set something up.
      </p>
    );
  }

  return (
    <ul className="routines">
      {routines.map((routine) => (
        <li className={`routine${routine.enabled ? "" : " is-paused"}`} key={routine.id}>
          <div className="routine-what">
            <p className="routine-label">{routine.label}</p>
            <p className="routine-when">
              {describeRoutine(routine)}
              <span className="routine-next">{nextRunText(routine.nextRunAt)}</span>
            </p>
          </div>

          {confirming === routine.id ? (
            <div className="routine-actions">
              <span className="routine-confirm">Delete this routine?</span>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  onDelete(routine.id);
                  setConfirming(undefined);
                }}
              >
                Delete
              </button>
              <button type="button" className="btn-quiet" onClick={() => setConfirming(undefined)}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="routine-actions">
              <button
                type="button"
                className="btn-quiet"
                onClick={() => onPause(routine.id, routine.enabled)}
              >
                {routine.enabled ? "Pause" : "Resume"}
              </button>
              <button type="button" className="btn-quiet" onClick={() => onRunNow(routine.id)}>
                Run now
              </button>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setConfirming(routine.id)}
                // Named, because four rows of "Delete" is four identical buttons
                // to anybody reading this with a screen reader.
                aria-label={`Delete ${routine.label}`}
              >
                Delete
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
