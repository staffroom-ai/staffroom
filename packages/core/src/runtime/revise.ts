/**
 * "revise: make it shorter".
 *
 * The previous deliverable goes back to the agent as its own words, so the model
 * is editing what it wrote rather than guessing at it from a description.
 */
import type { Message } from "../providers/types.js";
import type { Deliverable, Run } from "./events.js";

export const DEFAULT_REVISE_INSTRUCTION = "Improve it.";

export function buildReviseMessages(
  previous: { run: Run; deliverable: Deliverable },
  instructions: string,
): { messages: Message[]; prompt: string } {
  const what = instructions.trim().length === 0 ? DEFAULT_REVISE_INSTRUCTION : instructions.trim();
  return {
    prompt: what,
    messages: [
      { role: "user", content: previous.run.prompt },
      { role: "assistant", content: previous.deliverable.text },
    ],
  };
}
