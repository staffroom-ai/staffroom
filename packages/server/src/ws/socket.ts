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
import { buildGraph, detectEditors, noteIndexedDelta, noteRemovedDelta } from "@staffroom/core";
import type { WebSocket, WebSocketServer } from "ws";
import { CLOSE_UNAUTHORISED, tokenMatches } from "../auth.js";
import { runDoctor } from "../doctor/index.js";
import type { SampleAnswer, Scheduler } from "../scheduler/scheduler.js";
import { fromNoteWarning, pinnedTruncatedWarning } from "./brain-warnings.js";
import type { Handlers } from "./handlers.js";
import { handle } from "./handlers.js";
import { listProviderModels } from "./models.js";
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

/**
 * Events that change who is busy. These go out immediately rather than being
 * coalesced, because "who is working" is the question the office answers.
 */
const LIFECYCLE: ReadonlySet<string> = new Set([
  "started",
  "done",
  "failed",
  "cancelled",
  "approval_requested",
  "approval_resolved",
  "routed",
]);

interface Client {
  socket: WebSocket;
  helloed: boolean;
  lastSeen: number;
}

export interface SocketHubOptions {
  office: Office;
  /** SR-067: doctor reads the folder, not the running office. */
  officeDir: string;
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
  private unwatchBrain: (() => void) | undefined;
  private readonly editors = detectEditors();
  private scheduler: Scheduler | undefined;
  /** SR-066: the open question, or null once somebody has answered it. */
  private sampleQuestion: string | null = null;
  private sampleDeps: Handlers["samples"];

  constructor(options: SocketHubOptions) {
    this.options = options;

    // Run events go out unchanged: the office animates from the same record the
    // run log keeps.
    this.unsubscribe = options.office.store.subscribe((envelope: RunEventEnvelope) => {
      this.push({ type: "event", seq: 0, event: envelope });
      // A status change is the one thing the office exists to show, so it is not
      // made to wait behind the coalescing window. A replayed demo run finishes
      // in a few hundred milliseconds; with everything coalesced at 250 ms the
      // browser could receive its first snapshot after the work was already done
      // and never show anyone working at all.
      // SR-061: the pinned set is the only context every agent gets without
      // asking for it, so a note that fell out of it is an agent working without
      // something the owner believed it had. The run event fires once per run,
      // which is exactly how often this should be said.
      if (envelope.event.type === "brain_pinned_truncated") {
        this.broadcastBrainWarning(pinnedTruncatedWarning(envelope.event.noteIds));
      }

      if (LIFECYCLE.has(envelope.event.type)) this.pushStateNow();
      else this.scheduleState();
    });

    // Warnings raised while indexing: a note with front matter that will not
    // parse is indexed anyway, and the owner is the only one who can fix it.
    this.unwatchBrain = options.office.brain.subscribeWarnings((warning) => {
      this.broadcastBrainWarning(fromNoteWarning(warning));
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

    /*
     * SR-061: the graph goes to the one tab that asked, not to everybody.
     *
     * It is a whole snapshot — every note, every arrow — so broadcasting it
     * because one person opened a panel would send it to tabs that are looking
     * at something else entirely.
     */
    if (message.type === "brain.graph.get") {
      const graph = await buildGraph(this.options.office.brain, this.options.office.store, {
        includeReads: message.includeReads === true,
      });
      this.send(client, { type: "brain.graph", reqId: message.reqId, seq: this.next(), graph });
      return;
    }

    /*
     * SR-067: the same checks the terminal command runs, on the same office.
     *
     * Straight to `runDoctor` rather than shelling out to the CLI: the CLI is a
     * printer around this function, and two ways of producing an answer is two
     * ways for the answers to diverge. Sent only to the tab that asked, for the
     * same reason as the graph above.
     */
    if (message.type === "doctor.run") {
      const result = await runDoctor({ officeDir: this.options.officeDir });
      this.send(client, {
        type: "doctor.result",
        reqId: message.reqId,
        seq: this.next(),
        checks: result.checks,
        ok: result.ok,
      });
      return;
    }

    if (message.type === "models.list") {
      this.send(client, {
        type: "models.result",
        reqId: message.reqId,
        seq: this.next(),
        providers: await listProviderModels(this.options.office),
      });
      return;
    }

    const result = await handle(this.options.office, message, {
      scheduler: this.scheduler,
      samples: this.sampleDeps,
    });
    if (result.ok) {
      this.send(client, {
        type: "ack",
        reqId: message.reqId,
        seq: this.next(),
        ok: true,
        ...(result.result === undefined ? {} : { result: result.result }),
      });
      /*
       * SR-058: the ack, then the file.
       *
       * Assigning a tool rewrites agents.yaml, and the watcher would announce
       * that anyway — but only when the office is watching. An office started
       * with --no-watch would leave every other tab showing a roster that is no
       * longer what is on disk, so the change is announced by whoever made it.
       */
      if (message.type === "tools.assign") this.broadcastConfigReloaded("agents.yaml");
      // The same rule for routines: whoever changed the file announces it, so
      // every other tab follows without waiting on a watcher.
      if (message.type.startsWith("routine.") || message.type === "task.create") {
        if (this.scheduler !== undefined) this.broadcastConfigReloaded("routines.yaml");
      }
      this.scheduleState();
    } else {
      const error = result.error as { code: string; message: string; hint: string };
      this.send(client, { type: "error", reqId: message.reqId, seq: this.next(), ...error });
    }
  }

  private async welcome(client: Client, reqId: string, resumeFrom?: number): Promise<void> {
    const state = await collectState(
      this.options.office,
      undefined,
      this.scheduler,
      this.sampleQuestion,
    );
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
      // Detected once and reused: this is a handful of existsSync calls and the
      // answer cannot change while the office is open without an install.
      editors: this.editors,
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

  /**
   * One note changed on disk.
   *
   * A delta rather than a new graph: this fires from a file watcher, and sending
   * every note in the brain because somebody saved one of them in Obsidian would
   * be a snapshot per keystroke.
   */
  broadcastNoteIndexed(noteId: string): void {
    const delta = noteIndexedDelta(this.options.office.brain, noteId);
    if (delta === undefined) return;
    this.push({ type: "brain.note.indexed", seq: 0, node: delta.node, edges: delta.edges });
    this.scheduleState();
  }

  /** Call after the note has left the index, so the dangling links are real. */
  broadcastNoteRemoved(noteId: string): void {
    const delta = noteRemovedDelta(this.options.office.brain, noteId);
    this.push({
      type: "brain.note.removed",
      seq: 0,
      noteId: delta.id,
      ...(delta.nowMissing === undefined ? {} : { nowMissing: delta.nowMissing }),
      edges: delta.edges,
    });
    this.scheduleState();
  }

  /** Handed over once the office has one, so handlers and state can reach it. */
  useScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler;
  }

  /**
   * Puts the sample-content question in front of everybody looking.
   *
   * Held here rather than re-read from disk on every snapshot: the answer is
   * given once, and walking a brain folder thirty times a minute to be told the
   * same thing would be a strange way to ask a yes-or-no question.
   */
  askAboutSamples(
    question: string,
    deps: { brainDir: string; record(answer: SampleAnswer): void },
  ): void {
    this.sampleQuestion = question;
    this.sampleDeps = {
      brainDir: deps.brainDir,
      record: (answer) => {
        deps.record(answer);
        // Both cleared together, so the card cannot come back in a tab that was
        // open while another one answered.
        this.sampleQuestion = null;
        this.sampleDeps = undefined;
        this.pushStateNow();
      },
    };
  }

  /**
   * Something a routine did, or could not do.
   *
   * It goes in the feed rather than a log file: unattended work that failed
   * quietly is the failure mode the whole feature has to avoid.
   */
  broadcastRoutineNotice(message: string): void {
    this.push({ type: "brain.warning", seq: 0, scope: "index", reason: "routine", message });
  }

  broadcastBrainWarning(warning: {
    scope: "note" | "index" | "pinned";
    noteId?: string;
    reason: string;
    message: string;
  }): void {
    this.push({ type: "brain.warning", seq: 0, ...warning });
  }

  /** Coalesced, so a burst of events produces one snapshot rather than twenty. */
  /** Send the snapshot at once, and cancel any push already queued behind it. */
  private pushStateNow(): void {
    if (this.stateTimer !== undefined) {
      clearTimeout(this.stateTimer);
      this.stateTimer = undefined;
    }
    void this.pushState();
  }

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
    this.push({
      type: "state",
      seq: 0,
      state: await collectState(
        this.options.office,
        undefined,
        this.scheduler,
        this.sampleQuestion,
      ),
    });
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
  broadcastConfigReloaded(
    file: "agents.yaml" | "config.yaml" | "routines.yaml" | ".env" | "approvals.yaml",
  ): void {
    this.push({ type: "config.reloaded", seq: 0, file });
    this.scheduleState();
  }

  /** The previous good roster stays live; this only tells the office what broke. */
  broadcastConfigError(errors: ConfigError[]): void {
    this.push({ type: "config.error", seq: 0, errors });
  }

  /**
   * Forwards the watcher's card as it was built.
   *
   * This took the fields as positional arguments and quietly dropped whichever
   * ones the signature had not caught up with — twice. Passing the event through
   * means a new field on the card reaches the browser without anyone having to
   * remember this function exists.
   */
  broadcastToolsReloaded(card: Omit<Extract<ServerMessage, { type: "tools.reloaded" }>, "seq">) {
    this.push({ ...card, seq: 0 });
    this.scheduleState();
  }

  close(): void {
    this.unsubscribe?.();
    this.unwatchBrain?.();
    for (const timer of this.timers) clearInterval(timer);
    if (this.stateTimer !== undefined) clearTimeout(this.stateTimer);
    for (const client of this.clients) client.socket.close(1001, "server closing");
    this.clients.clear();
  }
}
