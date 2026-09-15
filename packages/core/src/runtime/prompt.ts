/**
 * Assembling an agent's system prompt.
 *
 * The order is the design. Identity, then the owner's own words, then what the
 * business has written down, then the tools, then what to produce, then the safety
 * rules. The rules come last so nothing an agent reads can appear after them and
 * position itself as an amendment.
 */
import { createHash } from "node:crypto";
import type { NoteFrontMatter } from "../brain/types.js";
import type { AgentConfig } from "../config/agents.js";
import { OUTPUT_CONTRACT, SAFETY_RULE } from "../prompt/safety-rule.js";
import type { RegisteredTool } from "../tools/registry.js";

const MAX_INSTRUCTIONS = 4000;
/** Rough, and only used to decide how many whole notes fit. */
const CHARS_PER_TOKEN = 3.5;

export interface PinnedNote {
  id: string;
  title: string;
  body: string;
  frontMatter: NoteFrontMatter;
}

export interface BuildPromptOptions {
  agent: AgentConfig;
  /** Display label, for the identity line. */
  department: string;
  office: { name: string; mode?: "live" | "demo" };
  pinnedNotes: PinnedNote[];
  tools: RegisteredTool[];
  pinnedTokenBudget?: number;
}

export interface BuiltPrompt {
  text: string;
  hash: string;
  pinnedIncluded: string[];
  pinnedTruncated: string[];
}

function trustOf(note: PinnedNote): "owner" | "agent" | "imported" {
  if (note.id.startsWith("90-archive/") || note.id.startsWith("inbox/")) return "imported";
  if (note.frontMatter.written_by?.startsWith("agent:")) return "agent";
  return "owner";
}

/** `- gmail.send_email (needs approval)` */
function toolLine(registered: RegisteredTool): string {
  const { tool } = registered;
  const parts: string[] = [tool.scope === "write" ? "needs approval" : "read"];
  if (tool.egress === true && tool.source.kind === "mcp") {
    parts.push(`sends its input to ${tool.source.server}`);
  } else if (tool.egress === true) {
    parts.push("sends its input off this computer");
  }
  return `- ${tool.name} (${parts.join(", ")})`;
}

export function buildSystemPrompt(options: BuildPromptOptions): BuiltPrompt {
  const { agent, department, office, pinnedNotes, tools } = options;
  const budgetChars = (options.pinnedTokenBudget ?? 2000) * CHARS_PER_TOKEN;
  const sections: string[] = [];

  // 1. Identity
  const who = agent.name ?? agent.role;
  sections.push(
    `You are ${who}, ${agent.role} in the ${department} department at ${office.name}. ${agent.does}`,
  );

  // 2. The owner's own words
  if (agent.instructions !== undefined && agent.instructions.trim().length > 0) {
    const text = agent.instructions.slice(0, MAX_INSTRUCTIONS);
    sections.push(`<owner_instructions>\n${text}\n</owner_instructions>`);
  }

  // 3. What the business has written down. Notes are dropped whole, in path
  // order, so a note is never half-present and half-missing.
  const pinnedIncluded: string[] = [];
  const pinnedTruncated: string[] = [];
  const blocks: string[] = [];
  let used = 0;

  for (const note of [...pinnedNotes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (office.mode === "live" && note.frontMatter.sample === true) continue;
    const updated = note.frontMatter.updated ?? note.frontMatter.created;
    const block = `<note path="${note.id}" updated="${updated}" trust="${trustOf(note)}">\n${note.body.trim()}\n</note>`;
    if (used + block.length > budgetChars && pinnedIncluded.length > 0) {
      pinnedTruncated.push(note.id);
      continue;
    }
    blocks.push(block);
    pinnedIncluded.push(note.id);
    used += block.length;
  }
  if (blocks.length > 0) sections.push(`About this business:\n\n${blocks.join("\n\n")}`);

  // 4. Tools. Schemas go through the adapter, not the prompt.
  if (tools.length > 0) {
    const lines = [...tools].sort((a, b) => a.tool.name.localeCompare(b.tool.name)).map(toolLine);
    sections.push(`Tools you can use:\n${lines.join("\n")}`);
  }

  // 5. What to produce
  sections.push(OUTPUT_CONTRACT);

  // 6. The rules. Always last.
  sections.push(SAFETY_RULE);

  const text = sections.join("\n\n");
  return {
    text,
    hash: createHash("sha256").update(text).digest("hex").slice(0, 16),
    pinnedIncluded,
    pinnedTruncated,
  };
}
