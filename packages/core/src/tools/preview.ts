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

/**
 * The card for a tool on somebody else's MCP server.
 *
 * Different from a local tool's preview in one way that matters: with a custom
 * tool we can read the code and say what it does. With an MCP server we cannot.
 * The card says so in as many words, because the honest thing to tell an owner
 * is that this is a decision about trusting the server, not about the fields.
 */
export const MCP_UNKNOWN =
  "Staffroom cannot see what this server will do with these fields; approve only if you trust it.";

/** First sentence of the server's own description, capped so a card stays a card. */
export function firstSentence(text: string, max = 120): string {
  const trimmed = text.trim();
  const end = /[.!?](\s|$)/.exec(trimmed);
  const sentence = end === null ? trimmed : trimmed.slice(0, end.index + 1);
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1)}…`;
}

/**
 * Where the call is going, said briefly.
 *
 * For an HTTP server the URL is reduced to scheme, host and port: a path or a
 * query string on an MCP endpoint often carries a tenant or a token, and an
 * approval card is exactly the wrong place to print one. For a stdio server only
 * the command's basename is shown, because the full path is noise.
 */
export function mcpDestination(server: string, config: unknown): string {
  const settings = (config ?? {}) as { url?: string; command?: string };

  if (typeof settings.url === "string") {
    try {
      const url = new URL(settings.url);
      return `${server} (MCP server at ${url.origin})`;
    } catch {
      return `${server} (MCP server)`;
    }
  }

  if (typeof settings.command === "string") {
    const basename = settings.command.split(/[/\\]/).pop() ?? settings.command;
    return `${server} (MCP server, ${basename})`;
  }

  return `${server} (MCP server)`;
}

export function mcpPreview(options: {
  server: string;
  description: string;
  config: unknown;
  input: unknown;
}): ApprovalPreview {
  const record =
    typeof options.input === "object" && options.input !== null
      ? (options.input as Record<string, unknown>)
      : {};
  const entries = Object.entries(record);

  return {
    action: firstSentence(options.description),
    destination: mcpDestination(options.server, options.config),
    summary: MCP_UNKNOWN,
    body: entries.length === 0 ? "(no input)" : stringify(record).trimEnd(),
    fields: entries
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([name, value]) => ({
        name,
        value: String(value),
        editable: DESTINATION_KEYS.includes(name.toLowerCase()),
      })),
    // Always. We cannot see what the server does, so we cannot claim it is safe.
    irreversible: true,
  };
}
