/**
 * Every keyboard shortcut, in one table.
 *
 * The handler and the help dialog both read this, so a binding cannot exist
 * without appearing in the help, and the help cannot claim one that does nothing.
 */

export interface Binding {
  keys: string;
  label: string;
  /** Grouped in the help dialog. */
  group: "Moving around" | "Working" | "Approvals" | "Demo";
  /** Chords need a second key; the first alone does nothing. */
  chord?: string;
  demoOnly?: boolean;
}

export const KEYMAP: Binding[] = [
  { keys: "Q", label: "Turn the office left", group: "Moving around" },
  { keys: "E", label: "Turn the office right", group: "Moving around" },
  { keys: "0", label: "Back to the whole office", group: "Moving around" },
  { keys: "Home", label: "Back to the whole office", group: "Moving around" },
  { keys: "[", label: "Previous person", group: "Moving around" },
  { keys: "]", label: "Next person", group: "Moving around" },
  { keys: "Esc", label: "Close what is open, then zoom out", group: "Moving around" },
  { keys: "G", label: "Open the brain", group: "Working" },
  { keys: "/", label: "Jump to the task box", group: "Working" },
  { keys: "C", label: "Open the chat with the selected person", group: "Working" },
  { keys: "?", label: "Show this list", group: "Working" },
  { keys: "A then Enter", label: "Approve what is waiting", group: "Approvals", chord: "Enter" },
  { keys: "D then Enter", label: "Decline what is waiting", group: "Approvals", chord: "Enter" },
  { keys: "D", label: "Change demo speed", group: "Demo", demoOnly: true },
];

/** A first key that opens a chord, so the handler knows to wait rather than act. */
export function chordFor(key: string, demoMode: boolean): Binding | undefined {
  return KEYMAP.find(
    (b) =>
      b.chord !== undefined && b.keys.startsWith(`${key} `) && (b.demoOnly !== true || demoMode),
  );
}

export function bindingFor(key: string, demoMode: boolean): Binding | undefined {
  return KEYMAP.find(
    (b) => b.chord === undefined && b.keys === key && (b.demoOnly !== true || demoMode),
  );
}

export function groups(): Binding["group"][] {
  return [...new Set(KEYMAP.map((b) => b.group))];
}
