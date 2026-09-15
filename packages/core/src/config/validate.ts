/**
 * The roster rules zod cannot express: uniqueness, leads, pod and seat limits, and
 * whether every tool an agent lists actually exists.
 */
import type { AgentsFile } from "./agents.js";
import {
  MAX_DEPARTMENTS,
  MAX_SEATS_PER_DEPARTMENT,
  MAX_SEATS_RECEPTION_POD,
  RECEPTION_POD_INDEX,
} from "./agents.js";
import type { McpConfig } from "./config.js";
import { type ConfigError, didYouMean } from "./errors.js";

/**
 * One method, so the validator does not depend on ToolRegistry. The registry
 * implements this; tests pass a Set.
 */
export interface ToolNameResolver {
  has(name: string): boolean;
}

export interface ValidateOptions {
  tools: ToolNameResolver;
  mcp: McpConfig;
  /** Configured provider ids. Empty means demo mode, where model prefixes are not checked. */
  providers: string[];
  demoMode?: boolean;
}

/** The three brain tools every agent gets, plus the alias for web search. */
const IMPLIED_TOOLS = new Set(["brain_search", "brain_read", "brain_write", "web", "web_search"]);

export function validateAgents(file: AgentsFile, options: ValidateOptions): ConfigError[] {
  const errors: ConfigError[] = [];
  const { tools, mcp, providers, demoMode = false } = options;

  const seenIds = new Set<string>();
  const departmentOrder: string[] = [];
  const byDepartment = new Map<string, number[]>();
  const mcpServers = new Set(Object.keys(mcp.servers));
  const denied = new Set(mcp.deny);

  file.agents.forEach((agent, i) => {
    const at = `agents[${i}]`;

    if (seenIds.has(agent.id)) {
      errors.push({
        code: "AGENT_ID_DUPLICATE",
        file: "agents.yaml",
        path: `${at}.id`,
        message: `Two agents share the id "${agent.id}" in office/agents.yaml. Ids must be unique.`,
      });
    }
    seenIds.add(agent.id);

    if (!departmentOrder.includes(agent.department)) departmentOrder.push(agent.department);
    const members = byDepartment.get(agent.department) ?? [];
    members.push(i);
    byDepartment.set(agent.department, members);

    if (agent.model !== undefined && !demoMode) {
      const prefix = agent.model.split("/")[0] as string;
      if (!providers.includes(prefix)) {
        errors.push({
          code: "AGENT_MODEL_PROVIDER_MISSING",
          file: "agents.yaml",
          path: `${at}.model`,
          message: `${agent.name ?? agent.id} uses ${prefix}, which is not configured in office/config.yaml.`,
          hint: `add a ${prefix}: block under providers, or change the model.`,
        });
      }
    }

    agent.tools.forEach((toolName, j) => {
      const path = `${at}.tools[${j}]`;
      if (IMPLIED_TOOLS.has(toolName)) return;

      if (mcpServers.has(toolName)) {
        if (denied.has(toolName)) {
          errors.push({
            code: "AGENT_TOOL_DENIED",
            file: "agents.yaml",
            path,
            message: `${toolName} is in mcp.deny, so no agent may use it.`,
            hint: "remove it from this agent, or from mcp.deny in office/config.yaml.",
          });
          return;
        }
        const wiredTo = mcp.departments[toolName];
        if (wiredTo !== undefined && !wiredTo.includes(agent.department)) {
          errors.push({
            code: "AGENT_TOOL_WRONG_DEPARTMENT",
            file: "agents.yaml",
            path,
            message: `${toolName} is not wired to the ${agent.department} pod.`,
            hint: `add ${agent.department} to mcp.departments.${toolName} in office/config.yaml.`,
          });
        }
        return;
      }

      if (tools.has(toolName)) return;

      const suggestion = didYouMean(toolName, [...mcpServers, ...IMPLIED_TOOLS]);
      errors.push({
        code: "AGENT_TOOL_UNKNOWN",
        file: "agents.yaml",
        path,
        message:
          suggestion === undefined
            ? `no tool called "${toolName}".`
            : `no tool called "${toolName}". Did you mean "${suggestion}"?`,
        hint: "check the name in office/tools/ or config.yaml mcp.servers.",
      });
    });
  });

  if (departmentOrder.length > MAX_DEPARTMENTS) {
    errors.push({
      code: "AGENT_DEPARTMENT_LIMIT",
      file: "agents.yaml",
      path: "agents",
      message: `The office has ${departmentOrder.length} departments but holds ${MAX_DEPARTMENTS} pods.`,
      hint: "merge two departments, or move an agent into an existing one.",
    });
  }

  departmentOrder.forEach((department, pod) => {
    const members = byDepartment.get(department) ?? [];
    const limit = pod === RECEPTION_POD_INDEX ? MAX_SEATS_RECEPTION_POD : MAX_SEATS_PER_DEPARTMENT;
    if (members.length > limit) {
      errors.push({
        code: "AGENT_SEAT_LIMIT",
        file: "agents.yaml",
        path: "agents",
        message:
          pod === RECEPTION_POD_INDEX
            ? `Department ${department} has ${members.length} agents but sits in the pod with the reception desk, which holds ${limit} in v1.`
            : `Department ${department} has ${members.length} agents but a pod holds ${limit}.`,
        hint: "move an agent to another department.",
      });
    }

    const leads = members.filter((i) => (file.agents[i] as { lead: boolean }).lead);
    if (leads.length > 1) {
      errors.push({
        code: "AGENT_LEAD_DUPLICATE",
        file: "agents.yaml",
        path: `agents[${leads[1] as number}].lead`,
        message: `Department ${department} has ${leads.length} leads. Only one agent per department can be the lead.`,
        hint: "remove lead: true from all but one.",
      });
    }
  });

  return errors;
}
