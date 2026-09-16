/**
 * The WebSocket layer.
 *
 * Two things here earn their keep. Pushes are numbered, and the last few thousand
 * are kept, so a tab that drops its connection for ten seconds asks for what it
 * missed instead of reloading the world. And a socket that has said nothing for a
 * minute is closed, because a laptop that went to sleep should not hold a
 * connection the office thinks is live.
 */
import { platform } from "node:os";
import type { ConfigError, Office, RunEventEnvelope } from "@staffroom/core";
import type { WebSocket, WebSocketServer } from "ws";
import { CLOSE_UNAUTHORISED, tokenMatches } from "../auth.js";
import { handle } from "./handlers.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { collectState } from "./state.js";

/** The three names the file manager has, so the browser need not guess. */
function platformName(): "mac" | "windows" | "linux" {
  const os = platform();
  if (os === "darwin") return "mac";
  if (os === "win32") return "windows";
  return "linux";
}

/** How many pushes to remember for reconnecting tabs. */
const RING_SIZE = 5000;
const SILENT_SOCKET_MS = 60_000;
const STATE_COALESCE_MS = 250;
const CLOCK_MS = 30_000;

interface Client {
  socket: WebSocket;
  helloed: boolean;
  lastSeen: number;
}

export interface SocketHubOptions {
  office: Office;
  token: string;
  version: string;
  /** Overridable so tests do not wait around. */
  coalesceMs?: number;
  clockMs?: number;
}

export class SocketHub {
  private readonly clients = new Set<Client>();
  private readonly ring: ServerMessage[] = [];
  private readonly options: SocketHubOptions;
  private seq = 0;
  private stateTimer: NodeJS.Timeout | undefined;
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(options: SocketHubOptions) {
    this.options = options;

    // Run events go out unchanged: the office animates from the same record the
    // run log keeps.
    this.unsubscribe = options.office.store.subscribe((envelope: RunEventEnvelope) => {
      this.push({ type: "event", seq: 0, event: envelope });
      this.scheduleState();
    });

    this.every(SILENT_SOCKET_MS / 2, () => this.dropSilentSockets());
    this.every(options.clockMs ?? CLOCK_MS, () => this.scheduleState());
  }

  private every(ms: number, fn: () => void): void {
    const timer = setInterval(fn, ms);
    timer.unref?.();
    this.timers.push(timer);
  }

  attach(wss: WebSocketServer): void {
    wss.on("connection", (socket: WebSocket) => this.accept(socket));
  }

  private accept(socket: WebSocket): void {
    const client: Client = { socket, helloed: false, lastSeen: Date.now() };
    this.clients.add(client);

    socket.on("message", (raw: Buffer) => {
      client.lastSeen = Date.now();
      void this.onMessage(client, raw.toString());
    });
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(client, {
        type: "error",
        seq: this.next(),
        code: "BAD_MESSAGE",
        message: "That message was not valid JSON.",
        hint: "This is a bug in the office; please report it.",
      });
      return;
    }

    if (message.type === "hello") {
      if (!tokenMatches(this.options.token, message.token)) {
        client.socket.close(CLOSE_UNAUTHORISED, "bad token");
        return;
      }
      client.helloed = true;
      await this.welcome(client, message.reqId, message.resumeFrom);
      return;
    }

    // Nothing but hello is answered before hello.
    if (!client.helloed) {
      client.socket.close(CLOSE_UNAUTHORISED, "hello first");
      return;
    }

    if (message.type === "ping") {
      this.send(client, { type: "pong", reqId: message.reqId, seq: this.next() });
      return;
    }

    if (message.type === "runs.replay") {
      await this.replay(client, message.reqId, message.runId);
      return;
    }

    const result = await handle(this.options.office, message);
    if (result.ok) {
      this.send(client, {
        type: "ack",
        reqId: message.reqId,
        seq: this.next(),
        ok: true,
        ...(result.result === undefined ? {} : { result: result.result }),
      });
      this.scheduleState();
    } else {
      const error = result.error as { code: string; message: string; hint: string };
      this.send(client, { type: "error", reqId: message.reqId, seq: this.next(), ...error });
    }
  }

  private async welcome(client: Client, reqId: string, resumeFrom?: number): Promise<void> {
    const state = await collectState(this.options.office);
    const missed = resumeFrom === undefined ? [] : this.since(resumeFrom);
    // A gap wider than the ring means we cannot prove what they missed, so they
    // get a fresh snapshot instead of a partial and misleading catch-up.
    const resumed = resumeFrom !== undefined && missed !== undefined;

    this.send(client, {
      type: "welcome",
      reqId,
      seq: this.next(),
      protocol: PROTOCOL_VERSION,
      version: this.options.version,
      mode: this.options.office.mode,
      platform: platformName(),
      resumed,
      state,
    });

    if (resumed && missed !== undefined) for (const message of missed) this.send(client, message);
  }

  /** Undefined when the gap is wider than we remember. */
  private since(seq: number): ServerMessage[] | undefined {
    const oldest = this.ring[0];
    if (oldest !== undefined && oldest.seq > seq + 1) return undefined;
    return this.ring.filter((m) => m.seq > seq);
  }

  private async replay(client: Client, reqId: string, runId: string): Promise<void> {
    const PAGE = 500;
    let page: RunEventEnvelope[] = [];
    for await (const envelope of this.options.office.store.events(runId)) {
      page.push(envelope);
      if (page.length === PAGE) {
        this.send(client, {
          type: "replay",
          reqId,
          seq: this.next(),
          runId,
          events: page,
          done: false,
        });
        page = [];
      }
    }
    this.send(client, { type: "replay", reqId, seq: this.next(), runId, events: page, done: true });
  }

  /** Coalesced, so a burst of events produces one snapshot rather than twenty. */
  scheduleState(): void {
    if (this.stateTimer !== undefined) return;
    const delay = this.options.coalesceMs ?? STATE_COALESCE_MS;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined;
      void this.pushState();
    }, delay);
    this.stateTimer.unref?.();
  }

  private async pushState(): Promise<void> {
    if (this.clients.size === 0) return;
    this.push({ type: "state", seq: 0, state: await collectState(this.options.office) });
  }

  private next(): number {
    return ++this.seq;
  }

  /** Numbered, remembered, then sent to everyone who has said hello. */
  private push(message: ServerMessage): void {
    const numbered = { ...message, seq: this.next() } as ServerMessage;
    this.ring.push(numbered);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    for (const client of this.clients) if (client.helloed) this.send(client, numbered);
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.socket.readyState !== 1) return;
    client.socket.send(JSON.stringify(message));
  }

  private dropSilentSockets(): void {
    const cutoff = Date.now() - SILENT_SOCKET_MS;
    for (const client of this.clients) {
      if (client.lastSeen < cutoff) {
        client.socket.close(1001, "idle");
        this.clients.delete(client);
      }
    }
  }

  /** Announced so an open tab reloads the roster rather than showing a stale one. */
  broadcastConfigReloaded(file: "agents.yaml" | "config.yaml" | ".env" | "approvals.yaml"): void {
    this.push({ type: "config.reloaded", seq: 0, file });
    this.scheduleState();
  }

  /** The previous good roster stays live; this only tells the office what broke. */
  broadcastConfigError(errors: ConfigError[]): void {
    this.push({ type: "config.error", seq: 0, errors });
  }

  broadcastToolsReloaded(file: string, ok: boolean): void {
    this.push({ type: "tools.reloaded", seq: 0, file, ok });
    this.scheduleState();
  }

  close(): void {
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    if (this.stateTimer !== undefined) clearTimeout(this.stateTimer);
    for (const client of this.clients) client.socket.close(1001, "server closing");
    this.clients.clear();
  }
}
