/**
 * The roster: agents, the pods they sit in, and the two edits the office makes to
 * agents.yaml while running.
 *
 * Those edits go through the yaml document API rather than dump(), because this is
 * a file the owner writes by hand. Losing their comments to a rename the lead did
 * automatically would be a good reason never to trust the office with the file
 * again.
 */
import { parseDocument, Scalar } from "yaml";
import type { AgentConfig, AgentsFile } from "./agents.js";

export interface Department {
  id: string;
  label: string;
  /** Position in the office, by first appearance in the file. 0-based. */
  pod: number;
  agents: AgentConfig[];
}

export interface Seat {
  agent: AgentConfig;
  department: string;
  pod: number;
  /** Desk within the pod, by order in the file. 0-based. */
  seat: number;
}

export class Roster {
  readonly file: AgentsFile;
  readonly agents: AgentConfig[];
  readonly departments: Department[];
  private readonly seats = new Map<string, Seat>();

  constructor(file: AgentsFile) {
    this.file = file;
    this.agents = file.agents;

    const order: string[] = [];
    const grouped = new Map<string, AgentConfig[]>();
    for (const agent of file.agents) {
      if (!order.includes(agent.department)) order.push(agent.department);
      const members = grouped.get(agent.department) ?? [];
      members.push(agent);
      grouped.set(agent.department, members);
    }

    this.departments = order.map((id, pod) => {
      const members = grouped.get(id) ?? [];
      members.forEach((agent, seat) => {
        this.seats.set(agent.id, { agent, department: id, pod, seat });
      });
      return { id, label: file.departments[id] ?? titleCase(id), pod, agents: members };
    });
  }

  get officeName(): string {
    return this.file.office.name;
  }

  get timezone(): string {
    return this.file.office.timezone;
  }

  get defaultModel(): string | undefined {
    return this.file.default_model;
  }

  agent(id: string): AgentConfig | undefined {
    return this.agents.find((a) => a.id === id);
  }

  seatOf(id: string): Seat | undefined {
    return this.seats.get(id);
  }

  department(id: string): Department | undefined {
    return this.departments.find((d) => d.id === id);
  }

  /** The declared lead, or the first agent listed in that department. */
  leadFor(department: string): AgentConfig | undefined {
    const members = this.department(department)?.agents ?? [];
    return members.find((a) => a.lead) ?? members[0];
  }

  /** Agents in a department other than its lead: who work can be routed to. */
  workersIn(department: string): AgentConfig[] {
    const lead = this.leadFor(department);
    return (this.department(department)?.agents ?? []).filter((a) => a.id !== lead?.id);
  }
}

function titleCase(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Edits agents.yaml in place, keeping every comment and the original formatting.
 * Returns the new file text; the caller writes it.
 */
export class RosterWriter {
  private readonly doc: ReturnType<typeof parseDocument>;

  constructor(yamlText: string) {
    this.doc = parseDocument(yamlText);
  }

  private agentNode(agentId: string): { node: unknown; index: number } | undefined {
    const agents = this.doc.get("agents") as { items?: unknown[] } | undefined;
    const items = agents?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const node = items[i] as { get?: (k: string) => unknown };
      if (node?.get?.("id") === agentId) return { node, index: i };
    }
    return undefined;
  }

  /**
   * Records who named them and when, because an owner opening the file will
   * wonder where the name came from.
   *
   * The value is built as a Scalar rather than passed as a plain string: set()
   * with a string stores a bare value with nowhere to hang the comment, and the
   * note is silently lost.
   */
  setName(agentId: string, name: string, namedBy: string, on: string): boolean {
    const found = this.agentNode(agentId);
    if (!found) return false;
    const node = found.node as { set: (k: string, v: unknown) => void };

    const value = new Scalar(name);
    value.comment = ` named by ${namedBy} on ${on}`;
    node.set("name", value);
    return true;
  }

  /**
   * Sets the office-wide default model.
   *
   * Top level rather than per agent: this is the model everybody uses unless
   * their own row says otherwise, and changing it must not quietly overwrite the
   * choices somebody made for individual staff.
   */
  setDefaultModel(model: string): boolean {
    if (this.doc.get("default_model") === model) return false;
    this.doc.set("default_model", model);
    return true;
  }

  addTool(agentId: string, tool: string): boolean {
    const found = this.agentNode(agentId);
    if (!found) return false;
    const node = found.node as {
      get: (k: string) => unknown;
      set: (k: string, v: unknown) => void;
    };
    const existing = node.get("tools") as
      | { items?: unknown[]; add?: (v: unknown) => void }
      | undefined;
    if (existing?.items === undefined) {
      node.set("tools", [tool]);
      return true;
    }
    // Items parsed from the file are Scalar nodes; items we added in this session
    // are plain strings. Both have to be checked or a duplicate slips through.
    const names = existing.items.map((i) =>
      typeof i === "string" ? i : (i as { value?: unknown }).value,
    );
    if (names.includes(tool)) return false;
    existing.add?.(tool);
    return true;
  }

  toString(): string {
    return String(this.doc);
  }
}
