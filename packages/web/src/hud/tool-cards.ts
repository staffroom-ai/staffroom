/**
 * What the Activity feed says about a tool file that just changed.
 *
 * Three different pieces of news arrive on one message, and the wording of each
 * is fixed by `tools-mcp-approvals.md`: it would not load and here is the line,
 * its author left the scope out so it will ask about every call, and nobody may
 * use it yet. They are written here as functions rather than inline in the card
 * so the exact sentences can be held to by a test — these are the ones an owner
 * pastes into an issue, so drifting wording costs real support.
 */
import type { ToolNotice } from "../store.js";

/** `Line 12: Unexpected end of file`, or just the message when nobody said where. */
export function failureDetail(notice: {
  line?: number | undefined;
  message?: string | undefined;
}): string {
  const message = notice.message ?? "It could not be loaded.";
  return notice.line === undefined ? message : `Line ${notice.line}: ${message}`;
}

export function failureText(notice: ToolNotice): string {
  return `Your tool file ${notice.file} could not be loaded. ${failureDetail(notice)}`;
}

/**
 * The exact sentence from the spec.
 *
 * It names the file rather than the tool because the fix is a line in that file,
 * and it says what the consequence is rather than only that something is
 * missing: "has no scope" alone would not tell anybody why they should care.
 */
export function noScopeText(file: string): string {
  return (
    `office/tools/${file} has no scope, so it will ask for approval every time. ` +
    'Add scope: "read" if it only looks things up.'
  );
}

export function assignText(tool: string): string {
  return `New tool ${tool} is ready. Who may use it?`;
}

/** The tool a card is about, whichever field carried it. */
export function toolOf(notice: ToolNotice): string | undefined {
  return notice.name ?? notice.tools?.[0];
}

/**
 * Does this card ask the owner a question?
 *
 * Only when there is a tool to give out and nobody has it. A file the owner has
 * already assigned should say it reloaded and get out of the way; re-asking
 * every time they save it is how a useful card becomes one people dismiss
 * without reading.
 */
export function asksWhoMayUse(notice: ToolNotice): boolean {
  return notice.ok && notice.unassigned === true && toolOf(notice) !== undefined;
}
