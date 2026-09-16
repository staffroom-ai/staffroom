/**
 * Where the owner says what they want.
 *
 * One composed control rather than three sitting beside each other: a department,
 * a sentence, and a way to send it. No prefixes and no syntax, because the whole
 * point of the office is that you say the thing and someone picks it up.
 *
 * "Every weekday at eight" is the same control. Making a routine a separate
 * screen would mean learning a second concept to say the same sentence with a
 * time attached, so the when lives here and the button changes to match.
 */
import type { OfficeState } from "@staffroom/core";
import { type FormEvent, type ReactElement, useState } from "react";
import {
  DEFAULT_CHOICE,
  describeChoice,
  type ScheduleChoice,
  scheduleSpecFor,
  submitLabel,
  WEEKDAYS,
  WHEN_OPTIONS,
} from "./schedule.js";

export function TaskBar({
  state,
  onSubmit,
  disabled,
}: {
  state: OfficeState;
  onSubmit: (
    department: string,
    text: string,
    schedule?: ReturnType<typeof scheduleSpecFor>,
  ) => void;
  disabled: boolean;
}): ReactElement {
  const [department, setDepartment] = useState(state.departments[0]?.id ?? "");
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<ScheduleChoice>(DEFAULT_CHOICE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const empty = text.trim().length === 0;
  const scheduled = choice.when !== "now";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (empty || disabled) return;
    onSubmit(department, text.trim(), scheduleSpecFor(choice));
    setText("");
    // The when stays put: somebody setting up three morning routines should not
    // have to choose "every weekday" three times.
    setPickerOpen(false);
  };

  return (
    <form className="taskbar" onSubmit={submit}>
      <select
        className="taskbar-department"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        aria-label="Department"
      >
        {state.departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <input
        className="taskbar-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask for something. Try: write a two-line tagline for the new bakery."
        aria-label="Task"
        data-testid="task-input"
        autoComplete="off"
      />

      <button
        type="button"
        className={`taskbar-when${scheduled ? " is-set" : ""}`}
        onClick={() => setPickerOpen((open) => !open)}
        aria-expanded={pickerOpen}
        // The whole choice, because the icon alone says "something about time"
        // and nothing about what was chosen.
        aria-label={`When: ${describeChoice(choice)}`}
        title={describeChoice(choice)}
      >
        <CalendarIcon />
        {scheduled && <span className="taskbar-when-text">{describeChoice(choice)}</span>}
      </button>

      {pickerOpen && (
        <div className="when-picker">
          <label className="when-row">
            <span className="when-label">When</span>
            <select
              value={choice.when}
              onChange={(e) =>
                setChoice((c) => ({ ...c, when: e.target.value as ScheduleChoice["when"] }))
              }
              aria-label="How often"
            >
              {WHEN_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {choice.when === "weekly" && (
            <label className="when-row">
              <span className="when-label">Day</span>
              <select
                value={choice.weekday}
                onChange={(e) =>
                  setChoice((c) => ({ ...c, weekday: e.target.value as ScheduleChoice["weekday"] }))
                }
                aria-label="Day of the week"
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.id} value={day.id}>
                    {day.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {choice.when === "monthly" && (
            <label className="when-row">
              <span className="when-label">Day</span>
              <input
                type="number"
                min={1}
                // The 29th onward does not exist in every month, so it is not
                // offered: a routine that skips February is worse than no
                // routine.
                max={28}
                value={choice.day}
                onChange={(e) =>
                  setChoice((c) => ({ ...c, day: Math.min(28, Math.max(1, +e.target.value || 1)) }))
                }
                aria-label="Day of the month"
              />
            </label>
          )}

          {scheduled && (
            <label className="when-row">
              <span className="when-label">Time</span>
              <input
                type="time"
                value={choice.time}
                onChange={(e) => setChoice((c) => ({ ...c, time: e.target.value }))}
                aria-label="Time"
              />
            </label>
          )}

          <p className="when-summary">{describeChoice(choice)}</p>
        </div>
      )}

      <button className="taskbar-send" type="submit" disabled={disabled || empty}>
        {submitLabel(choice, disabled)}
      </button>
    </form>
  );
}

/** A small calendar, drawn rather than imported: it is eight lines of SVG. */
function CalendarIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" />
      <path d="M1.5 6.5h13" stroke="currentColor" />
      <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}
