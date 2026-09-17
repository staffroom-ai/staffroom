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
import { isMap, parseDocument } from "yaml";
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
 * Adding or deleting a row by hand is a different thing and is not handled here.
 * That needs a real reload, which is `office.reload`.
 */
export function refreshAgents(officeDir: string, agentsFile: AgentsFile): boolean {
  let fresh: AgentsFile;
  try {
    fresh = loadAgentsFile(officeDir);
  } catch {
    // Half-edited on disk. The office keeps running on the last good roster.
    return false;
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
  for (const at of [["providers"], ["providers", provider]]) {
    const node = doc.getIn(at, true);
    if (isMap(node)) node.flow = false;
  }

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
    if (!isLocalKind(provider)) {
      const name = envKeyFor(provider);
      const path = join(officeDir, ".env");
      const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
      const line = `${name}=${key.trim()}`;

      if (new RegExp(`^${name}=`, "m").test(existing)) {
        writeFileSync(path, existing.replace(new RegExp(`^${name}=.*$`, "m"), line), "utf8");
      } else {
        const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
        appendFileSync(path, `${separator}${line}\n`, "utf8");
      }
    }

    nameProviderInConfig(officeDir, provider, key.trim());
    return true;
  } catch {
    return false;
  }
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
