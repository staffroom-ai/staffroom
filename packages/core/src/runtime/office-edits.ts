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
import type { AgentsFile } from "../config/agents.js";
import { loadAgentsFile } from "../config/load.js";
import { RosterWriter } from "../config/roster.js";

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

/**
 * Writes a key to office/.env.
 *
 * Never to config.yaml: that is the file owners paste into issues. The value is
 * not returned, not logged, and not echoed back over the socket.
 */
export function setProviderKey(officeDir: string, provider: string, key: string): boolean {
  if (!KNOWN_PROVIDERS.has(provider)) return false;
  if (key.trim().length === 0) return false;

  const name = envKeyFor(provider);
  const path = join(officeDir, ".env");

  try {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const line = `${name}=${key.trim()}`;

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
 * Shows a note in the owner's file manager.
 *
 * The point is not convenience. It is that a deliverable is an ordinary file in a
 * folder they own, and being able to see it there is what makes that believable.
 */
export function revealNote(brainDir: string, noteId: string): boolean {
  // The same containment rule the file routes use: nothing outside the brain.
  if (noteId.includes("..") || noteId.startsWith("/") || noteId.includes("\0")) return false;
  const path = join(brainDir, `${noteId}.md`);
  if (!existsSync(path)) return false;

  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const args = process.platform === "darwin" ? ["-R", path] : [path];

  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
