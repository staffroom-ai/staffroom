/**
 * Where the owner types what they want.
 *
 * A department and a sentence. No prefixes, no syntax: the point of the office is
 * that you say the thing and someone picks it up.
 */

import type { OfficeState } from "@staffroom/core";
import { type FormEvent, type ReactElement, useState } from "react";

export function TaskBar({
  state,
  onSubmit,
  disabled,
}: {
  state: OfficeState;
  onSubmit: (department: string, text: string) => void;
  disabled: boolean;
}): ReactElement {
  const [department, setDepartment] = useState(state.departments[0]?.id ?? "");
  const [text, setText] = useState("");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || disabled) return;
    onSubmit(department, trimmed);
    setText("");
  };

  return (
    <form className="taskbar" onSubmit={submit}>
      <select
        className="taskbar-department"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        aria-label="Which department"
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
        placeholder="Write a two-line tagline for a bakery"
        aria-label="What needs doing"
        data-testid="task-input"
      />

      <button
        className="taskbar-send"
        type="submit"
        disabled={disabled || text.trim().length === 0}
      >
        Give it to them
      </button>
    </form>
  );
}
