/**
 * Where the owner says what they want.
 *
 * One composed control rather than three sitting beside each other: a department,
 * a sentence, and a way to send it. No prefixes and no syntax, because the whole
 * point of the office is that you say the thing and someone picks it up.
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
  const empty = text.trim().length === 0;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (empty || disabled) return;
    onSubmit(department, text.trim());
    setText("");
  };

  return (
    <form className="taskbar" onSubmit={submit}>
      <select
        className="taskbar-department"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        aria-label="Which department should take this"
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
        aria-label="What needs doing"
        data-testid="task-input"
        autoComplete="off"
      />

      <button className="taskbar-send" type="submit" disabled={disabled || empty}>
        {disabled ? "Reconnecting" : "Send"}
      </button>
    </form>
  );
}
