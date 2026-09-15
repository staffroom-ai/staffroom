/**
 * The approval card for a tool whose author wrote no preview().
 *
 * A generated preview is deliberately pessimistic: it marks the action
 * irreversible and shows the whole input. An owner approving something should see
 * more than they need, not less.
 */
import { stringify } from "yaml";
import type { ApprovalPreview, ToolSource } from "../shared/types.js";
import type { Tool } from "./tool.js";

/** Keys that usually name where something is going. */
const DESTINATION_KEYS = [
  "to",
  "recipient",
  "email",
  "address",
  "channel",
  "url",
  "phone",
  "number",
];

function describeSource(source: ToolSource): string {
  switch (source.kind) {
    case "mcp":
      return source.server;
    case "custom":
      return "this computer";
    default:
      return "Staffroom";
  }
}

export function buildPreview(tool: Tool, input: unknown): ApprovalPreview {
  if (tool.preview !== undefined) return tool.preview(input);

  const record = (input ?? {}) as Record<string, unknown>;
  const entries = Object.entries(record);

  const destinationEntry = entries.find(([k]) => DESTINATION_KEYS.includes(k.toLowerCase()));
  const destination =
    destinationEntry === undefined ? describeSource(tool.source) : String(destinationEntry[1]);

  return {
    action: humanise(tool.name),
    destination,
    summary: tool.description,
    // The whole input, as YAML: readable, and nothing hidden behind an ellipsis.
    body: entries.length === 0 ? "(no input)" : stringify(record).trimEnd(),
    fields: entries
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([name, value]) => ({
        name,
        value: String(value),
        // A destination is the field an owner most often wants to correct.
        editable: DESTINATION_KEYS.includes(name.toLowerCase()),
      })),
    // Assumed, because we cannot know. A tool that can be undone says so itself.
    irreversible: true,
  };
}

/** lookup_order -> "Lookup order"; gmail.send_email -> "Send email". */
function humanise(name: string): string {
  const local = name.includes(".") ? (name.split(".")[1] as string) : name;
  const words = local.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
