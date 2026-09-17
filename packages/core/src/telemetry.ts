/**
 * Counting how Staffroom is used, only if the owner said yes.
 *
 * The entire value of this project rests on a claim: your business stays on your
 * machine. Telemetry is the one piece of code that could make that claim false,
 * so it is written to be checkable rather than trusted.
 *
 * Four things make it checkable:
 *
 *   Off unless the file says on. `telemetry.enabled` defaults to false and an
 *   absent block means false. Nothing asks at install time and nothing nags.
 *
 *   The payload is a fixed shape with no free-text field anywhere in it. There
 *   is no key a task, a note, an agent's name or an error message could travel
 *   in, so the question "could this leak X" is answered by reading the type
 *   rather than by auditing every call site forever.
 *
 *   Demo mode never sends, whatever the config says. Somebody looking at the
 *   thing for the first time has not agreed to anything.
 *
 *   `STAFFROOM_TELEMETRY=0` wins over the file, for a machine where the answer
 *   has to be no regardless of what is in the office folder.
 *
 * What is never sent, and has nowhere to go even by mistake: task text,
 * deliverable text, brain content, agent names, tool names, MCP server names,
 * hostnames, keys, error messages, file paths. Adding a field means editing
 * `repo-quality-launch.md` §9 in the same pull request.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Every event that can be sent. There are two. */
export interface TelemetryEvent {
  v: 1;
  /** A random id made on opt-in. Not derived from anything about the machine. */
  installId: string;
  event: "start" | "run_done";
  version: string;
  os: "darwin" | "linux" | "win32";
  /** Major only: "22", never the patch, which is close to a fingerprint. */
  node: string;
  /** Provider kinds, for example ["anthropic","ollama"]. Never models. */
  providers: string[];
  agentCount: number;
  toolSources: { mcp: number; custom: number };
  /** run_done only, rounded to 100 ms. */
  runDurationMs?: number;
  runOutcome?: "done" | "failed" | "cancelled";
  approvalUsed?: boolean;
}

export const DEFAULT_ENDPOINT = "https://t.staffroom.so/v1";

/** Batched at most this often, so an office is not a chatty thing on a network. */
export const FLUSH_INTERVAL_MS = 10 * 60 * 1000;

/** Beyond this, the oldest are dropped rather than kept forever in memory. */
export const MAX_QUEUE = 200;

export function telemetryIdPath(officeDir: string): string {
  return join(officeDir, ".staffroom", "telemetry-id");
}

/**
 * The install id, made once and then read.
 *
 * In the office folder rather than the home directory, so it is deletable the
 * same way everything else here is: remove the file and the next opt-in is a
 * different install. It is a random UUID and nothing else — not a hash of the
 * hostname, the username or the path, because any of those would be the same
 * value on the same machine forever whether or not the file was deleted.
 */
export function installId(officeDir: string): string {
  const path = telemetryIdPath(officeDir);
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8").trim();
      if (existing.length > 0) return existing;
    }
  } catch {
    // Unreadable is the same as absent: a new id, and nothing fails over it.
  }

  const made = randomUUID();
  try {
    mkdirSync(join(officeDir, ".staffroom"), { recursive: true });
    writeFileSync(path, `${made}\n`, "utf8");
  } catch {
    // A read-only office folder still gets an id for this process. It changes
    // next time, which undercounts installs — the honest failure direction.
  }
  return made;
}

export interface TelemetryOptions {
  officeDir: string;
  enabled: boolean;
  endpoint?: string;
  version: string;
  mode: "live" | "demo";
  /** Provider kinds configured. Never models. */
  providers: string[];
  agentCount: number;
  toolSources: { mcp: number; custom: number };
  env?: NodeJS.ProcessEnv;
  /** Overridable in tests so nothing here ever opens a socket. */
  send?: (endpoint: string, events: TelemetryEvent[]) => Promise<void>;
  now?: () => number;
}

/**
 * Whether anything may be sent at all.
 *
 * Every reason to say no is checked here, once, rather than at each call site:
 * a check that lives in three places is a check that is missing from one of
 * them after the next change.
 */
export function telemetryAllowed(options: {
  enabled: boolean;
  mode: "live" | "demo";
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = options.env ?? process.env;
  // The environment wins over the file, so a machine can refuse regardless of
  // what an office folder copied from somewhere else happens to say.
  if (env["STAFFROOM_TELEMETRY"] === "0") return false;
  if (options.mode === "demo") return false;
  return options.enabled;
}

export class Telemetry {
  private readonly options: TelemetryOptions;
  private readonly allowed: boolean;
  private readonly id: string;
  private queue: TelemetryEvent[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(options: TelemetryOptions) {
    this.options = options;
    this.allowed = telemetryAllowed({
      enabled: options.enabled,
      mode: options.mode,
      ...(options.env === undefined ? {} : { env: options.env }),
    });

    // The id file is only made when telemetry is actually on. An office that
    // never opted in should not carry an identifier it never agreed to.
    this.id = this.allowed ? installId(options.officeDir) : "";
  }

  get on(): boolean {
    return this.allowed;
  }

  /** The event as it would be sent, for `doctor telemetry` to print. */
  build(
    event: TelemetryEvent["event"],
    extra: Pick<TelemetryEvent, "runDurationMs" | "runOutcome" | "approvalUsed"> = {},
  ): TelemetryEvent {
    const major = process.versions.node.split(".")[0] ?? "";
    const os = process.platform;
    return {
      v: 1,
      installId: this.id.length > 0 ? this.id : "(made when you turn this on)",
      event,
      version: this.options.version,
      os: os === "darwin" || os === "win32" ? os : "linux",
      node: major,
      providers: [...this.options.providers].sort(),
      agentCount: this.options.agentCount,
      toolSources: this.options.toolSources,
      ...(extra.runDurationMs === undefined
        ? {}
        : // To 100 ms. A millisecond figure is a much better fingerprint than
          // it looks, and nothing here needs that resolution.
          { runDurationMs: Math.round(extra.runDurationMs / 100) * 100 }),
      ...(extra.runOutcome === undefined ? {} : { runOutcome: extra.runOutcome }),
      ...(extra.approvalUsed === undefined ? {} : { approvalUsed: extra.approvalUsed }),
    };
  }

  record(
    event: TelemetryEvent["event"],
    extra: Pick<TelemetryEvent, "runDurationMs" | "runOutcome" | "approvalUsed"> = {},
  ): void {
    if (!this.allowed) return;

    this.queue.push(this.build(event, extra));
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE);

    // Started on the first event rather than at construction, so an office that
    // is on but idle holds no timer.
    if (this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (!this.allowed || this.queue.length === 0) return;

    const events = this.queue;
    this.queue = [];
    const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT;

    try {
      await (this.options.send ?? postEvents)(endpoint, events);
    } catch {
      // Dropped, not retried. A queue that grows while a collector is down is a
      // memory leak in somebody's office, and these are counts: losing ten
      // minutes of them costs nothing that matters.
    }
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }
}

/** One POST, no cookies, no redirects followed, and a short deadline. */
async function postEvents(endpoint: string, events: TelemetryEvent[]): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
