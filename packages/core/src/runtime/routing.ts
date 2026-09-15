/**
 * The lead picks who does the work.
 *
 * A route run is a real run so the office can show it and the owner can see why a
 * task went where it did, but it never produces a deliverable and never writes to
 * the brain: it hands over a brief and stops.
 */
import { z } from "zod";
import type { AgentConfig } from "../config/agents.js";
import type { Roster } from "../config/roster.js";
import type { Message, ProviderAdapter, ToolSpec } from "../providers/types.js";
import { RunError } from "./errors.js";

export interface RouteDecision {
  agentId: string;
  brief: string;
  /** Only when the chosen member had no name yet. */
  name?: string;
}

export const ASSIGN_TASK = "assign_task";

export function assignTaskSpec(team: AgentConfig[]): ToolSpec {
  return {
    name: ASSIGN_TASK,
    description: "Give this task to one member of your team, with a brief.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", enum: team.map((a) => a.id) },
        brief: { type: "string" },
        name: { type: "string", description: "A first name, only if the member has none yet." },
      },
      required: ["agent_id", "brief"],
      additionalProperties: false,
    },
  };
}

const DecisionSchema = z.object({
  agent_id: z.string(),
  brief: z.string().min(1),
  name: z.string().min(1).max(40).optional(),
});

export function buildRoutingPrompt(task: string, team: AgentConfig[]): string {
  const lines = team.map((a) => {
    const who = a.name ?? "unnamed";
    const tools = a.tools.length > 0 ? a.tools.join(", ") : "none";
    return `- ${a.id} (${who}, ${a.role}): ${a.does} Tools: ${tools}`;
  });
  return `A new task has arrived for your department:\n"${task}"\n\nYour team:\n${lines.join("\n")}\n\nPick the one team member best placed to do this, and write them a brief in one paragraph.`;
}

/** First `{` to last `}`, for models that cannot be forced into a tool call. */
export function parseDecisionFromText(text: string): RouteDecision | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = DecisionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return undefined;
    const { agent_id, brief, name } = parsed.data;
    return name === undefined ? { agentId: agent_id, brief } : { agentId: agent_id, brief, name };
  } catch {
    return undefined;
  }
}

export interface RouteOptions {
  adapter: ProviderAdapter;
  model: string;
  systemPrompt: string;
  task: string;
  team: AgentConfig[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

/**
 * Asks the lead. Returns the decision, or undefined when the model gave something
 * unusable, which the caller turns into BAD_ROUTING and a fallback.
 */
export async function askLead(options: RouteOptions): Promise<RouteDecision | undefined> {
  const { adapter, model, systemPrompt, task, team, signal } = options;
  const forced = adapter.capabilities(model).supportsForcedTool;

  const instruction = forced
    ? buildRoutingPrompt(task, team)
    : `${buildRoutingPrompt(task, team)}\n\nReply with only a JSON object with keys agent_id, brief and optional name.`;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: instruction },
  ];

  let text = "";
  const calls = [];
  for await (const chunk of adapter.complete(messages, forced ? [assignTaskSpec(team)] : [], {
    model,
    maxTokens: options.maxOutputTokens,
    signal,
    ...(forced ? { forceTool: ASSIGN_TASK } : {}),
  })) {
    if (chunk.type === "text") text += chunk.text;
    else if (chunk.type === "tool_call") calls.push(chunk.call);
  }

  const call = calls.find((c) => c.name === ASSIGN_TASK);
  if (call !== undefined) {
    const parsed = DecisionSchema.safeParse(call.input);
    if (parsed.success) {
      const { agent_id, brief, name } = parsed.data;
      return name === undefined ? { agentId: agent_id, brief } : { agentId: agent_id, brief, name };
    }
  }
  return parseDecisionFromText(text);
}

/** Validates the lead's choice against the actual team. */
export function resolveDecision(
  decision: RouteDecision | undefined,
  team: AgentConfig[],
  roster: Roster,
): { chosen: AgentConfig; brief: string; name?: string } | undefined {
  if (decision === undefined) return undefined;
  const chosen = team.find((a) => a.id === decision.agentId);
  if (chosen === undefined) return undefined;

  // A name already used in the office is dropped rather than duplicated.
  const taken = new Set(roster.agents.map((a) => a.name?.toLowerCase()).filter(Boolean));
  const name =
    decision.name !== undefined &&
    chosen.name === undefined &&
    !taken.has(decision.name.toLowerCase())
      ? decision.name
      : undefined;

  return name === undefined
    ? { chosen, brief: decision.brief }
    : { chosen, brief: decision.brief, name };
}

export function badRouting(lead: AgentConfig, fallback: AgentConfig): RunError {
  return new RunError("BAD_ROUTING", {
    lead: lead.name ?? lead.id,
    agent: fallback.name ?? fallback.id,
  });
}
