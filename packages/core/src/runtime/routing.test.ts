/**
 * How a lead's answer is read when the model would not use the tool.
 *
 * Every adapter is asked to force `assign_task`, but not every model obeys, and
 * some wrap the call in a sentence or a code fence. The fallback parser is what
 * stops "I'll give this to the copywriter, here's the JSON: {...}" from being a
 * routing failure the owner has to diagnose.
 *
 * It is also the place where a model's output becomes a decision the office
 * acts on, so what it refuses matters as much as what it accepts.
 */
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../config/agents.js";
import { assignTaskSpec, buildRoutingPrompt, parseDecisionFromText } from "./routing.js";

const team: AgentConfig[] = [
  {
    id: "copywriter",
    department: "marketing",
    role: "Copywriter",
    does: "Turns briefs into copy.",
    tools: ["web"],
    name: "Priya",
  },
  {
    id: "designer",
    department: "marketing",
    role: "Brand designer",
    does: "Produces image briefs.",
    tools: [],
  },
] as AgentConfig[];

describe("reading a decision out of plain text", () => {
  it("takes the JSON out of a sentence wrapped around it", () => {
    expect(
      parseDecisionFromText(
        'Sure — {"agent_id": "copywriter", "brief": "Write the tagline."} should do it.',
      ),
    ).toEqual({ agentId: "copywriter", brief: "Write the tagline." });
  });

  it("reads one out of a code fence, which is how models like to answer", () => {
    const text = '```json\n{"agent_id": "designer", "brief": "Draw the banner."}\n```';
    expect(parseDecisionFromText(text)).toEqual({
      agentId: "designer",
      brief: "Draw the banner.",
    });
  });

  it("keeps a name when the member had none yet", () => {
    expect(
      parseDecisionFromText('{"agent_id": "designer", "brief": "Draw it.", "name": "Mo"}'),
    ).toEqual({ agentId: "designer", brief: "Draw it.", name: "Mo" });
  });

  it("leaves the name out rather than carrying an empty one", () => {
    const decision = parseDecisionFromText('{"agent_id": "designer", "brief": "Draw it."}');
    expect(decision).not.toHaveProperty("name");
  });

  it("refuses text with no object in it", () => {
    expect(parseDecisionFromText("I am not sure who should do this.")).toBeUndefined();
  });

  it("refuses a closing brace that comes first", () => {
    expect(parseDecisionFromText("} not really json {")).toBeUndefined();
  });

  it("refuses an object that will not parse", () => {
    // Half a JSON object is not a routing decision, and guessing at what the
    // model meant would send somebody's work to whoever the guess landed on.
    expect(parseDecisionFromText('{"agent_id": "copywriter", "brief":')).toBeUndefined();
  });

  it("refuses a decision with no brief, which is the half that matters", () => {
    expect(parseDecisionFromText('{"agent_id": "copywriter", "brief": ""}')).toBeUndefined();
    expect(parseDecisionFromText('{"agent_id": "copywriter"}')).toBeUndefined();
  });

  it("refuses a name longer than a first name", () => {
    expect(
      parseDecisionFromText(
        `{"agent_id": "designer", "brief": "Draw it.", "name": "${"x".repeat(41)}"}`,
      ),
    ).toBeUndefined();
  });
});

describe("what the lead is asked", () => {
  it("names every team member, their role and their tools", () => {
    const prompt = buildRoutingPrompt("Write a tagline", team);
    expect(prompt).toContain("Write a tagline");
    expect(prompt).toContain("copywriter (Priya, Copywriter)");
    expect(prompt).toContain("Tools: web");
  });

  it("says a member has no name yet rather than leaving a gap", () => {
    expect(buildRoutingPrompt("x", team)).toContain("designer (unnamed, Brand designer)");
  });

  it("says none rather than an empty list for somebody with no tools", () => {
    expect(buildRoutingPrompt("x", team)).toContain("Tools: none");
  });
});

describe("the tool the lead is given", () => {
  it("offers only the ids on this team", () => {
    const spec = assignTaskSpec(team);
    const properties = spec.inputSchema["properties"] as {
      agent_id: { enum: string[] };
    };
    // An enum rather than a free string: a lead cannot hand work to somebody
    // who is not in the department.
    expect(properties.agent_id.enum).toEqual(["copywriter", "designer"]);
  });

  it("requires a brief, and takes nothing it did not ask for", () => {
    const spec = assignTaskSpec(team);
    expect(spec.inputSchema["required"]).toEqual(["agent_id", "brief"]);
    expect(spec.inputSchema["additionalProperties"]).toBe(false);
  });
});
