/**
 * Turning a brain problem into a sentence the owner can act on.
 *
 * Core reports these as reason codes, because core does not know who is reading.
 * The office does, and an owner staring at `invalid_front_matter` learns nothing
 * they can do anything about. Each message below names the file, says what is
 * wrong with it, and says what still works — because in every one of these cases
 * the note was indexed anyway, and the owner should not think their writing has
 * been thrown away.
 */
import type { NoteWarning } from "@staffroom/core";

export interface BrainWarning {
  scope: "note" | "index" | "pinned";
  noteId?: string;
  reason: string;
  message: string;
}

export function noteWarningMessage(warning: NoteWarning): string {
  switch (warning.reason) {
    case "missing_created":
      return `${warning.id} has no created date, so the office used the file's own. Add created: to its front matter to set it yourself.`;
    case "invalid_front_matter":
      return `The front matter in ${warning.id} would not parse, so only its text was indexed. It is still searchable; the tags and dates in it are not.`;
    case "missing_title":
      return `${warning.id} has no title, so the office used its filename. Add title: to its front matter to name it yourself.`;
    default:
      return `${warning.id} has a problem the office does not have words for yet (${warning.reason}). It was indexed anyway.`;
  }
}

export function fromNoteWarning(warning: NoteWarning): BrainWarning {
  return {
    scope: "note",
    noteId: warning.id,
    reason: warning.reason,
    message: noteWarningMessage(warning),
  };
}

/**
 * The pinned set did not fit.
 *
 * This one matters more than it looks. The pinned notes are the only context
 * every agent gets without asking, so a note that silently fell out of them is
 * an agent quietly working without something the owner believed it had. Naming
 * the notes that were dropped is the whole point of the message.
 */
export function pinnedTruncatedWarning(noteIds: string[]): BrainWarning {
  const names = noteIds.join(", ");
  return {
    scope: "pinned",
    reason: "pinned_truncated",
    message:
      `Your pinned notes are over the budget, so your staff did not see ${names}. ` +
      "Shorten a pinned note, unpin one, or raise brain.pinned_token_budget in office/config.yaml.",
  };
}
