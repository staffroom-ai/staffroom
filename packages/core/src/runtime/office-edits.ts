/**
 * The edits the office makes to the owner's own files while it is running.
 *
 * All four go through the yaml document API or append to .env, never a dump and
 * rewrite, because these are files the owner reads and edits by hand. Losing
 * their comments to a rename is a good reason never to trust the office with the
 * file again.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, isMap, parseDocument } from "yaml";
import type { AgentsFile } from "../config/agents.js";
import { loadAgentsFile } from "../config/load.js";
import { RosterWriter } from "../config/roster.js";
import { openCommandFor } from "./editors.js";

/** Providers the office knows how to configure. */
const KNOWN_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "ollama",
  "groq",
  "together",
  "openrouter",
]);

const ENV_KEY: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  together: "TOGETHER_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function envKeyFor(provider: string): string {
  return ENV_KEY[provider] ?? `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

function editRoster(officeDir: string, edit: (writer: RosterWriter) => boolean): boolean {
  const path = join(officeDir, "agents.yaml");
  try {
    const writer = new RosterWriter(readFileSync(path, "utf8"));
    if (!edit(writer)) return false;
    writeFileSync(path, writer.toString(), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function renameAgent(officeDir: string, agentId: string, name: string, by = "you"): boolean {
  const on = new Date().toISOString().slice(0, 10);
  return editRoster(officeDir, (writer) => writer.setName(agentId, name, by, on));
}

/** The model everybody uses unless their own row says otherwise. */
export function setDefaultModel(officeDir: string, model: string): boolean {
  return editRoster(officeDir, (writer) => writer.setDefaultModel(model));
}

/** What a refused edit says, so the caller can show it rather than invent one. */
export type EditResult = { ok: true } | { ok: false; reason: string };

function editRosterFor(officeDir: string, edit: (writer: RosterWriter) => EditResult): EditResult {
  const path = join(officeDir, "agents.yaml");
  try {
    const writer = new RosterWriter(readFileSync(path, "utf8"));
    const result = edit(writer);
    if (!result.ok) return result;
    writeFileSync(path, writer.toString(), "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Could not write agents.yaml.",
    };
  }
}

export function addAgent(
  officeDir: string,
  agent: {
    id: string;
    department: string;
    role: string;
    does: string;
    name?: string;
    model?: string;
    /** Opens the department as part of the hire, when it is not there yet. */
    departmentLabel?: string;
  },
): EditResult {
  return editRosterFor(officeDir, (writer) => writer.addAgent(agent));
}

export function removeAgent(officeDir: string, agentId: string): EditResult {
  return editRosterFor(officeDir, (writer) => writer.removeAgent(agentId));
}

export function updateAgent(
  officeDir: string,
  agentId: string,
  fields: {
    role?: string;
    does?: string;
    department?: string;
    model?: string | null;
    tools?: string[];
  },
): EditResult {
  return editRosterFor(officeDir, (writer) => writer.updateAgent(agentId, fields));
}

export function setOfficeName(officeDir: string, name: string): EditResult {
  return editRosterFor(officeDir, (writer) => writer.setOfficeName(name));
}

export function addDepartment(officeDir: string, id: string, label: string): EditResult {
  return editRosterFor(officeDir, (writer) => writer.addDepartment(id, label));
}

export function renameDepartment(officeDir: string, id: string, label: string): EditResult {
  return editRosterFor(officeDir, (writer) => writer.renameDepartment(id, label));
}

export function removeDepartment(officeDir: string, id: string): EditResult {
  return editRosterFor(officeDir, (writer) => writer.removeDepartment(id));
}

export function assignTool(officeDir: string, agentId: string, tool: string): boolean {
  return editRoster(officeDir, (writer) => writer.addTool(agentId, tool));
}

/**
 * Brings the running office's copy of the roster back in line with the file.
 *
 * The office read agents.yaml once, at boot, and everything since then — the
 * roster, its seats, the runner — holds the same agent objects. Writing the file
 * therefore changed nothing that was already running: a tool the owner handed
 * out from the card did not reach the agent, and the next `state` still showed
 * the old row. Nothing said so, which is the worst version of that bug.
 *
 * So the fields are copied onto the objects that are already there, matched by
 * id, rather than a new file object being swapped in: every holder of a
 * reference sees the change at once and nothing has to be rebuilt.
 *
 * Adding or deleting a row is handled too, when a roster is passed: it reseats
 * itself in place, so the pods and desks are worked out again and everybody
 * holding a reference sees the new office.
 */
export function refreshAgents(
  officeDir: string,
  agentsFile: AgentsFile,
  roster?: { reseat: (fresh: AgentsFile) => void },
): boolean {
  let fresh: AgentsFile;
  try {
    fresh = loadAgentsFile(officeDir);
  } catch {
    // Half-edited on disk. The office keeps running on the last good roster.
    return false;
  }

  /*
   * With a roster, hires and leavers land too.
   *
   * Without one this copies fields onto matching ids and skips anything new,
   * which meant adding a person to agents.yaml did nothing at all until a
   * restart — and the only other way in, `office.reload`, was never
   * implemented. Somebody following the documentation to add staff watched the
   * office ignore them.
   */
  if (roster !== undefined) {
    roster.reseat(fresh);
    return true;
  }

  for (const row of fresh.agents) {
    const existing = agentsFile.agents.find((agent) => agent.id === row.id);
    if (existing === undefined) continue;
    Object.assign(existing, row);
  }
  agentsFile.default_model = fresh.default_model;
  agentsFile.office = fresh.office;
  agentsFile.departments = fresh.departments;
  return true;
}

/** Ollama runs on the owner's own machine, so what it takes is an address. */
function isLocalKind(provider: string): boolean {
  return provider === "ollama";
}

/**
 * Names the provider in config.yaml, so the office can actually use the key.
 *
 * Without this the key is written and nothing happens. The office builds its
 * adapters from `providers` in config.yaml, and the shipped template ships
 * `providers: {}` — so a key in .env that nothing in config.yaml refers to is a
 * key nothing reads, and the office stays in demo mode with a success message on
 * screen. That was the shape of the bug: every part worked and the whole did
 * not.
 *
 * The key itself never comes near this file. What goes in is `$ANTHROPIC_API_KEY`
 * — the name, which is what config.yaml is for and what its own header tells the
 * owner to write.
 *
 * Edited through the document API so the commented-out examples above
 * `providers: {}`, which are how most people learn this file, survive it.
 */
/**
 * Block style, not `providers: { anthropic: { api_key: $X } }`.
 *
 * The template writes empty sections as `{}`, which is a flow map, and yaml keeps
 * the style it found — so the first thing written into one turned the section
 * into a single unreadable line, two lines above the commented-out example it
 * was supposed to look like. This is a file people edit by hand.
 */
function unflow(doc: Document, paths: string[][]): void {
  for (const at of paths) {
    const node = doc.getIn(at, true);
    if (isMap(node)) node.flow = false;
  }
}

function nameProviderInConfig(officeDir: string, provider: string, value: string): void {
  const path = join(officeDir, "config.yaml");
  if (!existsSync(path)) return;

  const doc = parseDocument(readFileSync(path, "utf8"));
  // A config.yaml that does not parse is one somebody is in the middle of
  // editing. Writing over it would lose their work to a key paste.
  if (doc.errors.length > 0) return;

  const field = isLocalKind(provider) ? "base_url" : "api_key";
  const written = isLocalKind(provider) ? value : `$${envKeyFor(provider)}`;

  // Only if it is not already said. An owner who pointed this provider at a
  // proxy, or named a different variable, meant it.
  if (doc.getIn(["providers", provider, field]) !== undefined) return;

  doc.setIn(["providers", provider, field], written);

  /*
   * Block style, not `providers: { anthropic: { api_key: $X } }`.
   *
   * The template ships `providers: {}`, which is a flow map, and yaml keeps the
   * style it found — so the first key pasted turned the section into one long
   * line that looks nothing like the commented-out example two lines below it.
   * This is a file people edit by hand.
   */
  unflow(doc, [["providers"], ["providers", provider]]);

  writeFileSync(path, String(doc), "utf8");
}

/**
 * Writes a key to office/.env, and names the provider in config.yaml.
 *
 * The key itself never goes to config.yaml: that is the file owners paste into
 * issues. Only its variable name does. The value is not returned, not logged,
 * and not echoed back over the socket.
 *
 * For Ollama the value is an address rather than a key — there is nothing
 * secret about it — so it goes straight into config.yaml as `base_url` and
 * nothing is written to .env.
 */
export function setProviderKey(officeDir: string, provider: string, key: string): boolean {
  if (!KNOWN_PROVIDERS.has(provider)) return false;
  if (key.trim().length === 0) return false;

  try {
    if (!isLocalKind(provider) && !writeEnvLine(officeDir, envKeyFor(provider), key.trim())) {
      return false;
    }
    nameProviderInConfig(officeDir, provider, key.trim());
    return true;
  } catch {
    return false;
  }
}

/** One NAME=value in office/.env, replaced in place if it is already there. */
function writeEnvLine(officeDir: string, name: string, value: string): boolean {
  const path = join(officeDir, ".env");
  try {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const line = `${name}=${value}`;

    if (new RegExp(`^${name}=`, "m").test(existing)) {
      writeFileSync(path, existing.replace(new RegExp(`^${name}=.*$`, "m"), line), "utf8");
    } else {
      const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      appendFileSync(path, `${separator}${line}\n`, "utf8");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Edits config.yaml through the document API.
 *
 * Shared by everything that writes to it, so the "comments survive" rule is kept
 * in one place rather than remembered in four. A file that will not parse is one
 * somebody is in the middle of editing: writing over it would lose their work.
 */
function editConfig(officeDir: string, edit: (doc: Document) => boolean): boolean {
  const path = join(officeDir, "config.yaml");
  if (!existsSync(path)) return false;

  try {
    const doc = parseDocument(readFileSync(path, "utf8"));
    if (doc.errors.length > 0) return false;
    if (!edit(doc)) return false;
    writeFileSync(path, String(doc), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds or replaces an MCP server in config.yaml.
 *
 * Written through the document API like everything else here, so the commented
 * examples that teach the file survive somebody adding a connector from
 * Settings. The office re-reads the file afterwards; this only writes it.
 */
export function setMcpServer(
  officeDir: string,
  name: string,
  server: Record<string, unknown>,
): EditResult {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
    return { ok: false, reason: "A connector name is lower case letters, numbers and dashes." };
  }

  const ok = editConfig(officeDir, (doc) => {
    doc.setIn(["mcp", "servers", name], server);
    unflow(doc, [["mcp"], ["mcp", "servers"], ["mcp", "servers", name]]);
    return true;
  });
  return ok ? { ok: true } : { ok: false, reason: "Could not write office/config.yaml." };
}

export function removeMcpServer(officeDir: string, name: string): EditResult {
  const ok = editConfig(officeDir, (doc) => {
    doc.deleteIn(["mcp", "servers", name]);
    // Its wiring goes with it; a department list for a server nobody has is a
    // line the owner would find later and not understand.
    doc.deleteIn(["mcp", "departments", name]);
    return true;
  });
  return ok ? { ok: true } : { ok: false, reason: "Could not write office/config.yaml." };
}

/**
 * Which departments a connector is wired to.
 *
 * An empty list means every department, which is what the absence of the key
 * means to the registry — so it is written as an absence rather than as `[]`,
 * and the file says what the office does.
 */
export function setMcpDepartments(
  officeDir: string,
  name: string,
  departments: string[],
): EditResult {
  const ok = editConfig(officeDir, (doc) => {
    if (departments.length === 0) doc.deleteIn(["mcp", "departments", name]);
    else {
      doc.setIn(["mcp", "departments", name], departments);
      unflow(doc, [["mcp", "departments"]]);
    }
    return true;
  });
  return ok ? { ok: true } : { ok: false, reason: "Could not write office/config.yaml." };
}

/** Web search backends that need a key, and the variable each one's key lives in. */
const WEB_SEARCH_KEYS: Record<string, string> = {
  brave: "BRAVE_API_KEY",
  tavily: "TAVILY_API_KEY",
};

/**
 * Turns web search on, or off.
 *
 * The key follows the same rule as a provider key: the value goes to .env and
 * only its name goes in config.yaml. `none` leaves any key that is already
 * there alone — somebody turning search off for an afternoon should not have to
 * find their key again afterwards.
 */
export function setWebSearch(officeDir: string, provider: string, key?: string): boolean {
  const variable = WEB_SEARCH_KEYS[provider];

  if (variable !== undefined && key !== undefined && key.trim().length > 0) {
    if (!writeEnvLine(officeDir, variable, key.trim())) return false;
  }

  return editConfig(officeDir, (doc) => {
    doc.setIn(["tools", "web", "provider"], provider);
    if (variable !== undefined) doc.setIn(["tools", "web", "api_key"], `$${variable}`);
    unflow(doc, [["tools"], ["tools", "web"]]);
    return true;
  });
}

/** Whether this office sends anything at all. Off is the default and stays it. */
export function setTelemetry(officeDir: string, on: boolean): boolean {
  return editConfig(officeDir, (doc) => {
    doc.setIn(["telemetry", "enabled"], on);
    unflow(doc, [["telemetry"]]);
    return true;
  });
}

/**
 * Shows a note in the owner's file manager.
 *
 * The point is not convenience. It is that a deliverable is an ordinary file in a
 * folder they own, and being able to see it there is what makes that believable.
 */
/**
 * Shows a note in the file manager, or opens it in an editor the owner has.
 *
 * `app` is an editor id from `detectEditors`, never a command: this ends in a
 * spawn, and a command arriving over the socket would be a command the office
 * runs for whoever can reach it. An id that is not a detected editor falls back
 * to the file manager rather than guessing.
 */
/**
 * How to show a file in this platform's file manager.
 *
 * The platform is a parameter, the same reason `candidatesFor` takes one: a
 * branch that only ever runs on the OS it belongs to is a branch nobody has
 * read since it was written. macOS gets `-R` so the folder opens with the file
 * selected, rather than opening the file itself in whatever owns `.md`.
 */
export function fileManagerFor(
  os: NodeJS.Platform,
  path: string,
): { command: string; args: string[] } {
  if (os === "darwin") return { command: "open", args: ["-R", path] };
  if (os === "win32") return { command: "explorer", args: [path] };
  return { command: "xdg-open", args: [path] };
}

export function revealNote(brainDir: string, noteId: string, app?: string): boolean {
  // The same containment rule the file routes use: nothing outside the brain.
  if (noteId.includes("..") || noteId.startsWith("/") || noteId.includes("\0")) return false;
  const path = join(brainDir, `${noteId}.md`);
  if (!existsSync(path)) return false;

  const editor = app === undefined || app === "finder" ? undefined : openCommandFor(app, path);

  const { command, args } = editor ?? fileManagerFor(process.platform, path);

  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
