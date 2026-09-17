/**
 * The checks that need more than a glance at one file.
 *
 * Split out of index.ts because each of these reads something different — the
 * MCP config, the whitelist, every note in the brain — and a run of them inline
 * would bury the shape of `runDoctor` under the detail of what each one looks
 * at.
 *
 * Every check answers the same question: is there something here the owner
 * would want to know, and can they act on it? A check that reports a fact
 * nobody can do anything about is noise, and noise is what makes people stop
 * reading the output.
 */
import type { Dirent } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OfficeConfig } from "@staffroom/core";
import { approvalsPath, frontMatterOf, isSkipped } from "@staffroom/core";
import { parse } from "yaml";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  hint?: string;
  fixed?: boolean;
}

const ok = (id: string, message: string, hint?: string): DoctorCheck => ({
  id,
  status: "ok",
  message,
  ...(hint === undefined ? {} : { hint }),
});
const warn = (id: string, message: string, hint?: string): DoctorCheck => ({
  id,
  status: "warn",
  message,
  ...(hint === undefined ? {} : { hint }),
});

/**
 * One line per MCP server, because "MCP is fine" is not an answer.
 *
 * Not connected to: that would mean starting somebody else's program as a side
 * effect of asking whether the office is healthy. What can be said without
 * running anything is whether it is configured sensibly and whether its secrets
 * resolve, which is where the mistakes actually are.
 */
export function mcpChecks(config: OfficeConfig): DoctorCheck[] {
  const servers = Object.entries(config.mcp.servers);
  if (servers.length === 0) return [ok("mcp", "No MCP servers configured.")];

  const denied = new Set(config.mcp.deny);
  return servers.map(([name, server]) => {
    const id = `mcp.${name}`;
    if (denied.has(name)) {
      return ok(id, `Denied in config, so it is never connected.`);
    }

    // A server is either a command with an env or a url with headers, and the
    // union does not let both be read at once. Widened once, here, rather than
    // branching twice for a check that treats them the same.
    const shape = server as {
      command?: string;
      url?: string;
      env?: Record<string, string>;
      headers?: Record<string, string>;
      token?: string;
    };

    const unresolved = [
      ...Object.entries(shape.env ?? {}),
      ...Object.entries(shape.headers ?? {}),
      ...(shape.token === undefined ? [] : [["token", shape.token] as const]),
    ].filter(([, value]) => typeof value === "string" && /^\$[A-Z0-9_]+$/.test(value));

    if (unresolved.length > 0) {
      const names = unresolved.map(([, value]) => String(value).slice(1)).join(", ");
      return warn(
        id,
        `${names} did not resolve, so this server will not connect.`,
        `Add ${names} to office/.env.`,
      );
    }

    const how = shape.command === undefined ? `at ${shape.url}` : `via ${shape.command}`;
    return ok(id, `Configured ${how}.`);
  });
}

/** Whether the web tool will actually work, which is not the same as configured. */
export function webCheck(config: OfficeConfig): DoctorCheck {
  const web = config.tools.web;
  if (web.provider === "none") {
    return ok("tools.web", "No web search, so nobody can look anything up online.");
  }

  const needsKey = web.provider === "brave" || web.provider === "tavily";
  if (needsKey && (web.api_key === undefined || web.api_key.startsWith("$"))) {
    return warn(
      "tools.web",
      `${web.provider} needs a key and it did not resolve, so searches will fail.`,
      "Put the key in office/.env and name it in config.yaml.",
    );
  }
  if (web.provider === "searxng" && web.base_url === undefined) {
    return warn(
      "tools.web",
      "searxng needs the address of your own instance.",
      "Set tools.web.base_url in office/config.yaml.",
    );
  }
  return ok("tools.web", `Web search via ${web.provider}.`);
}

/**
 * Standing permissions, and specifically the ones nobody is using.
 *
 * A permission granted six weeks ago and never used since is one the owner has
 * forgotten they gave. That is the row worth naming: it is not broken, and it
 * is exactly the thing somebody would take back if they remembered it existed.
 */
export function whitelistCheck(officeDir: string, now = Date.now()): DoctorCheck {
  let rows: Array<{ agent?: string; tool?: string; last_used?: string; expires?: string }>;
  try {
    const parsed = parse(readFileSync(approvalsPath(officeDir), "utf8")) as {
      allow?: unknown;
    } | null;
    rows = Array.isArray(parsed?.allow) ? (parsed.allow as typeof rows) : [];
  } catch {
    return ok("approvals.whitelist", "Nothing has standing permission.");
  }

  if (rows.length === 0) return ok("approvals.whitelist", "Nothing has standing permission.");

  const stale = rows.filter((row) => {
    if (row.last_used === undefined) return true;
    const used = Date.parse(row.last_used);
    return Number.isFinite(used) && now - used > 30 * 24 * 60 * 60 * 1000;
  });

  if (stale.length === 0) {
    return ok("approvals.whitelist", `${rows.length} standing permission(s), all in use.`);
  }

  const named = stale
    .slice(0, 5)
    .map((row) => `${row.tool ?? "?"} for ${row.agent ?? "?"}`)
    .join(", ");
  return warn(
    "approvals.whitelist",
    `${stale.length} of ${rows.length} standing permission(s) unused for a month: ${named}.`,
    "Revoke them in Settings, or delete the rows from office/approvals.yaml.",
  );
}

/**
 * Links in the brain that point at nothing.
 *
 * A broken link is a note an agent will be told exists and then cannot read, so
 * it answers around the gap rather than saying it could not find something.
 */
export function linksCheck(index: {
  brokenLinks?: () => Array<{ from: string; to: string }>;
}): DoctorCheck {
  const broken = index.brokenLinks?.() ?? [];
  if (broken.length === 0) return ok("brain.links", "Every link between notes resolves.");

  const named = broken
    .slice(0, 5)
    .map((l) => `${l.from} → ${l.to}`)
    .join(", ");
  return warn(
    "brain.links",
    `${broken.length} link(s) point at a note that is not there: ${named}.`,
    "Fix the link, or write the note it is asking for.",
  );
}

/**
 * Something in a note that looks like a secret.
 *
 * The brain is the one place in the office where an owner writes freely, and
 * "the Stripe key is sk_live_..." is a note somebody will absolutely make. Every
 * agent reads these, and a pinned one goes into every prompt — so a key in a
 * note is a key sent to a model provider.
 *
 * `_private/` is excluded because it is never indexed and never read by an
 * agent, which is exactly where such a note is meant to live.
 */
export function secretsCheck(brainDir: string): DoctorCheck {
  // Deliberately narrow. A regex that flagged every long string would flag
  // every note, and a check that cries wolf is one people learn to ignore.
  const KEY_LIKE =
    /\b(sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/;
  const LONG_NUMBER = /\b\d[\d -]{14,22}\d\b/;

  const found: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "_private" || entry.name.startsWith(".")) continue;
        walk(join(dir, entry.name), rel);
        continue;
      }
      if (isSkipped(rel)) continue;

      let text: string;
      try {
        text = readFileSync(join(dir, entry.name), "utf8");
      } catch {
        continue;
      }
      if (frontMatterOf(text)?.private === true) continue;
      if (KEY_LIKE.test(text) || LONG_NUMBER.test(text)) {
        found.push(rel.replace(/\.md$/i, ""));
      }
    }
  };

  walk(brainDir, "");

  if (found.length === 0) return ok("brain.secrets", "No note looks like it holds a secret.");
  return warn(
    "brain.secrets",
    `${found.length} note(s) contain something shaped like a key or a card number: ${found.slice(0, 5).join(", ")}.`,
    "Every agent reads these, and a pinned one goes into every prompt. Move it to brain/_private/, which is never indexed.",
  );
}

/** What runs without being asked, and whether anything is overdue. */
export function schedulerCheck(officeDir: string): DoctorCheck {
  let routines: Array<{ id?: string; label?: string; paused?: boolean }>;
  try {
    const parsed = parse(readFileSync(join(officeDir, "routines.yaml"), "utf8")) as {
      routines?: unknown;
    } | null;
    routines = Array.isArray(parsed?.routines) ? (parsed.routines as typeof routines) : [];
  } catch {
    return ok("scheduler", "No routines, so nothing runs unattended.");
  }

  if (routines.length === 0) return ok("scheduler", "No routines, so nothing runs unattended.");

  const paused = routines.filter((r) => r.paused === true).length;
  const live = routines.length - paused;

  // Said plainly, because unattended work is the part of the office that
  // happens while nobody is looking and the owner should know its size.
  const detail = paused === 0 ? "" : `, ${paused} paused`;
  return ok("scheduler", `${live} routine(s) will run unattended${detail}.`);
}
