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
import {
  AGENT_ID,
  type AgentConfig,
  type AgentsFile,
  DEPARTMENT_ID,
  MAX_AGENTS,
  MAX_DEPARTMENTS,
} from "./agents.js";

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
    this.departments = [];
    this.place();
  }

  /**
   * Works out the departments and who sits where, from the roster as it is now.
   *
   * Split out of the constructor so a roster change can be applied to the object
   * everybody is already holding. The office hands `roster` to the runner, to
   * the state builder and to the scene, all of which captured it at boot: making
   * a new Roster would leave every one of them on the old one, which is the
   * shape of bug where the office shows staff that no longer exist.
   */
  private place(): void {
    const order: string[] = [];
    const grouped = new Map<string, AgentConfig[]>();
    for (const agent of this.agents) {
      if (!order.includes(agent.department)) order.push(agent.department);
      const members = grouped.get(agent.department) ?? [];
      members.push(agent);
      grouped.set(agent.department, members);
    }

    this.seats.clear();
    // Emptied in place rather than reassigned, for the same reason as above.
    this.departments.length = 0;
    for (const [pod, id] of order.entries()) {
      const members = grouped.get(id) ?? [];
      members.forEach((agent, seat) => {
        this.seats.set(agent.id, { agent, department: id, pod, seat });
      });
      this.departments.push({
        id,
        label: this.file.departments[id] ?? titleCase(id),
        pod,
        agents: members,
      });
    }
  }

  /**
   * Takes a roster that has been edited on disk, including hires and leavers.
   *
   * People who are still there keep their object, so anything holding a
   * reference to an agent keeps working; new rows are added and departed ones
   * drop out, and the seats and pods are worked out again.
   */
  reseat(fresh: AgentsFile): void {
    const kept = fresh.agents.map((row) => {
      const existing = this.agents.find((agent) => agent.id === row.id);
      if (existing === undefined) return row;
      Object.assign(existing, row);
      return existing;
    });

    this.agents.splice(0, this.agents.length, ...kept);
    this.file.agents = this.agents;
    this.file.departments = fresh.departments;
    this.file.office = fresh.office;
    this.file.default_model = fresh.default_model;
    this.place();
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

  /** Everybody currently in the file, in file order. */
  agentIds(): string[] {
    const agents = this.doc.get("agents") as { items?: unknown[] } | undefined;
    return (agents?.items ?? [])
      .map((node) => {
        const value = (node as { get?: (k: string) => unknown })?.get?.("id");
        return typeof value === "string" ? value : "";
      })
      .filter((id) => id.length > 0);
  }

  /**
   * Every department there is: the labelled ones and the ones people are in.
   *
   * `departments:` is optional — it is a map of display names, and a roster is
   * perfectly valid without it. Reading only that map meant a file with no
   * `departments:` block had no departments as far as these checks were
   * concerned, so hiring into the department somebody was already sitting in
   * was refused for not existing.
   */
  departmentIds(): string[] {
    const labelled = this.labelledDepartmentIds();
    const inUse = this.agentIds()
      .map((id) => {
        const node = this.agentNode(id)?.node as { get?: (k: string) => unknown } | undefined;
        const value = node?.get?.("department");
        return typeof value === "string" ? value : "";
      })
      .filter((id) => id.length > 0);

    return [...new Set([...labelled, ...inUse])];
  }

  /** Only the ones with a display name, which is what the map itself holds. */
  private labelledDepartmentIds(): string[] {
    const map = this.doc.get("departments") as { items?: unknown[] } | undefined;
    return (map?.items ?? [])
      .map((pair) => {
        // Keys parsed from the file are Scalar nodes; keys added in this session
        // are plain strings. Reading only the first shape made a department
        // added a moment ago invisible to every check below — so hiring into it
        // was refused with "there is no department called legal", about a
        // department the same writer had just opened.
        const key = (pair as { key?: unknown })?.key;
        if (typeof key === "string") return key;
        const value = (key as { value?: unknown })?.value;
        return typeof value === "string" ? value : "";
      })
      .filter((id) => id.length > 0);
  }

  /**
   * Hires somebody.
   *
   * Refuses rather than repairs: an id that is already taken, an id that is not
   * an id, a department nobody has made, or a roster already at its limit. The
   * caller is a person filling in a form, and "that id is taken" is a thing they
   * can act on where a silently renamed agent is not.
   */
  addAgent(agent: {
    id: string;
    department: string;
    role: string;
    does: string;
    name?: string;
    model?: string;
    /**
     * Opens the department as part of the hire, when it is not there yet.
     *
     * Departments exist by virtue of somebody working in one — `departments:` is
     * a map of display names, not a list — so there is no such thing as an empty
     * department. Opening one and then hiring into it had to become a single
     * action, because the first half on its own did nothing anybody could see:
     * not in the room, not in Settings, and not in the form's own department
     * list, so the person who had just created it could not put anybody in it.
     */
    departmentLabel?: string;
  }): { ok: true } | { ok: false; reason: string } {
    if (!AGENT_ID.test(agent.id)) {
      return {
        ok: false,
        reason: "An id is lower case letters, numbers and dashes, and starts with a letter.",
      };
    }
    if (this.agentIds().includes(agent.id)) {
      return { ok: false, reason: `There is already somebody with the id ${agent.id}.` };
    }
    if (!this.departmentIds().includes(agent.department)) {
      if (agent.departmentLabel === undefined) {
        return { ok: false, reason: `There is no department called ${agent.department}.` };
      }
      const opened = this.addDepartment(agent.department, agent.departmentLabel);
      if (!opened.ok) return opened;
    }
    if (this.agentIds().length >= MAX_AGENTS) {
      return { ok: false, reason: `An office holds at most ${MAX_AGENTS} people.` };
    }

    const row: Record<string, unknown> = {
      id: agent.id,
      department: agent.department,
      ...(agent.name === undefined ? {} : { name: agent.name }),
      role: agent.role,
      does: agent.does,
      ...(agent.model === undefined ? {} : { model: agent.model }),
    };

    const agents = this.doc.get("agents") as { add?: (v: unknown) => void } | undefined;
    if (agents?.add === undefined) {
      this.doc.set("agents", [row]);
      return { ok: true };
    }
    agents.add(this.doc.createNode(row));
    return { ok: true };
  }

  /**
   * Removes somebody from the roster.
   *
   * Their filed work stays in the brain. A deliverable is the owner's, and
   * deleting somebody's notes because they left the roster would be the office
   * throwing away work nobody asked it to throw away.
   *
   * The last person cannot go: an office with no staff will not load, and the
   * owner would be left with a file they have to hand-edit to recover.
   */
  removeAgent(agentId: string): { ok: true } | { ok: false; reason: string } {
    const found = this.agentNode(agentId);
    if (!found) return { ok: false, reason: `There is nobody with the id ${agentId}.` };
    if (this.agentIds().length <= 1) {
      return { ok: false, reason: "An office needs at least one member of staff." };
    }

    const agents = this.doc.get("agents") as { delete?: (i: number) => void };
    agents.delete?.(found.index);
    return { ok: true };
  }

  /**
   * Changes the fields of somebody who is already there.
   *
   * Only the fields passed. An undefined field is one the form did not touch,
   * which is not the same as one the owner cleared, and treating them alike is
   * how an edit to a role silently empties a set of tools.
   */
  updateAgent(
    agentId: string,
    fields: {
      role?: string;
      does?: string;
      department?: string;
      model?: string | null;
      /** The whole list, so a checkbox can take a tool away as well as give it. */
      tools?: string[];
    },
  ): { ok: true } | { ok: false; reason: string } {
    const found = this.agentNode(agentId);
    if (!found) return { ok: false, reason: `There is nobody with the id ${agentId}.` };
    if (fields.department !== undefined && !this.departmentIds().includes(fields.department)) {
      return { ok: false, reason: `There is no department called ${fields.department}.` };
    }

    const node = found.node as {
      set: (k: string, v: unknown) => void;
      delete: (k: string) => void;
    };
    if (fields.role !== undefined) node.set("role", fields.role);
    if (fields.does !== undefined) node.set("does", fields.does);
    if (fields.department !== undefined) node.set("department", fields.department);
    // null is "use the office default again", which is the absence of the key
    // rather than an empty string: an empty model id fails validation.
    if (fields.model === null) node.delete("model");
    else if (fields.model !== undefined) node.set("model", fields.model);
    // Set whole rather than added to: `addTool` can only give, and a panel with
    // checkboxes has to be able to take back.
    if (fields.tools !== undefined) node.set("tools", fields.tools);
    return { ok: true };
  }

  /**
   * Renames the office.
   *
   * The name on the top bar, and what the staff call the place in a prompt. It
   * is the first thing somebody wants to change after opening a template, and
   * it was previously only reachable by editing the file.
   */
  setOfficeName(name: string): { ok: true } | { ok: false; reason: string } {
    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, reason: "An office needs a name." };
    if (trimmed.length > 60)
      return { ok: false, reason: "An office name is 60 characters or less." };

    const office = this.doc.get("office") as { set?: (k: string, v: unknown) => void } | undefined;
    if (office?.set === undefined) return { ok: false, reason: "agents.yaml has no office block." };
    office.set("name", trimmed);
    return { ok: true };
  }

  addDepartment(id: string, label: string): { ok: true } | { ok: false; reason: string } {
    if (!DEPARTMENT_ID.test(id)) {
      return { ok: false, reason: "A department id is lower case letters, numbers and dashes." };
    }
    if (this.departmentIds().includes(id)) {
      return { ok: false, reason: `There is already a department called ${id}.` };
    }
    if (this.departmentIds().length >= MAX_DEPARTMENTS) {
      // The floor is a ring of six wedges; a seventh has nowhere to stand.
      return { ok: false, reason: `An office holds at most ${MAX_DEPARTMENTS} departments.` };
    }

    const map = this.doc.get("departments") as
      | { set?: (k: string, v: unknown) => void }
      | undefined;
    if (map?.set === undefined) this.doc.set("departments", { [id]: label });
    else map.set(id, label);
    return { ok: true };
  }

  renameDepartment(id: string, label: string): { ok: true } | { ok: false; reason: string } {
    const map = this.doc.get("departments") as
      | { set?: (k: string, v: unknown) => void }
      | undefined;
    if (!this.departmentIds().includes(id)) {
      return { ok: false, reason: `There is no department called ${id}.` };
    }
    map?.set?.(id, label);
    return { ok: true };
  }

  /**
   * Closes a department.
   *
   * Refused while anybody is in it, rather than moving them somewhere or
   * deleting them. Both of those are decisions about people's work that the
   * owner should make one at a time, and the message says who is in the way.
   */
  removeDepartment(id: string): { ok: true } | { ok: false; reason: string } {
    if (!this.departmentIds().includes(id)) {
      return { ok: false, reason: `There is no department called ${id}.` };
    }

    const staff = this.agentIds().filter((agentId) => {
      const found = this.agentNode(agentId);
      const node = found?.node as { get?: (k: string) => unknown } | undefined;
      return node?.get?.("department") === id;
    });
    if (staff.length > 0) {
      // One person "works", several "work". The office says this to somebody who
      // is mid-task, and a sentence that does not parse reads as a broken tool.
      const verb = staff.length === 1 ? "works" : "work";
      return {
        ok: false,
        reason: `${staff.join(", ")} still ${verb} in ${id}. Move them first.`,
      };
    }
    if (this.departmentIds().length <= 1) {
      return { ok: false, reason: "An office needs at least one department." };
    }

    const map = this.doc.get("departments") as { delete?: (k: string) => void } | undefined;
    map?.delete?.(id);
    return { ok: true };
  }

  toString(): string {
    return String(this.doc);
  }
}
