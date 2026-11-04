/**
 * Everything the office knows.
 *
 * The rule from office-ui.md: this is a render layer over one OfficeState. The
 * store keeps that snapshot, plus what is local to this tab (what is selected,
 * what is open, what has been animated). It never derives business facts of its
 * own, so the browser and the office can never disagree about what is true.
 */

import type { OfficeState, RunEventEnvelope } from "@staffroom/core";
import { create } from "zustand";
import { type ActivityLine, type AnimationCue, dedupeCues, ingestEvent } from "./cues.js";
import type { Connection } from "./ws.js";

const MAX_ACTIVITY = 200;
const MAX_CUES = 60;

/**
 * Something the office noticed about a tool file. Kept as a list rather than
 * shown as a toast: a card about a tool that will not compile has to survive long
 * enough for the owner to read the line number and copy it.
 */
export interface ToolNotice {
  id: number;
  /**
   * What this card is about.
   *
   * A brain warning and a broken tool file both arrive as cards in the feed, but
   * "Your tool file x could not be loaded" is the wrong sentence for a note with
   * unparseable front matter, and telling somebody the wrong thing went wrong
   * costs them the time it takes to go and look.
   */
  kind?: "tool" | "brain";
  file: string;
  ok: boolean;
  message?: string;
  /** Where it broke, when the compiler said. 1-based. */
  line?: number;
  tools?: string[];
  /** The tool this file defines. */
  name?: string;
  /** Its author left `scope` out, so it will ask about every call. */
  warning?: "no_scope";
  /** Nobody may use it yet. */
  unassigned?: boolean;
  /** Everyone who could be given it, as the office knew them at the time. */
  agents?: { id: string; name: string }[];
}

export interface ChatTurn {
  runId: string;
  role: "owner" | "agent";
  text: string;
  at: number;
}

export interface OfficeStore {
  connection: Connection;
  state: OfficeState | undefined;
  mode: "live" | "demo";
  version: string;
  /** From `welcome`, so the UI can name the file manager the owner actually has. */
  platform: "mac" | "windows" | "linux";
  /** Markdown editors on this machine. Empty means no "Open in editor". */
  editors: { id: string; label: string }[];

  selectedAgentId: string | null;
  /**
   * Who the pointer is over in the room, and where the pointer is.
   *
   * The room draws everybody as the same neutral figure on purpose — the
   * silhouette is the strongest thing on the plate and nobody carries a
   * department colour. That makes it a room you can read at a glance and a room
   * in which you cannot tell Dana from Priya, which is fine until you want to
   * click on somebody in particular.
   */
  hovered: { id: string; x: number; y: number } | null;
  focusedPod: number | null;
  rail: "closed" | "chat" | "activity" | "approvals";
  overlay: "none" | "brain" | "help" | "settings";

  activity: ActivityLine[];
  animations: AnimationCue[];
  chats: Record<string, ChatTurn[]>;
  /** Who each run belongs to. Most events do not carry an agent id of their own. */
  runAgents: Record<string, string>;
  /** Task requests we are waiting on, so a routed event can open the right chat. */
  pendingTaskReqIds: Set<string>;
  toolNotices: ToolNotice[];
  lastError: { code: string; message: string; hint: string } | undefined;

  setConnection: (connection: Connection) => void;
  applyWelcome: (
    state: OfficeState,
    mode: "live" | "demo",
    version: string,
    platform?: "mac" | "windows" | "linux",
    editors?: { id: string; label: string }[],
  ) => void;
  applyState: (state: OfficeState) => void;
  applyEvent: (envelope: RunEventEnvelope, reducedMotion?: boolean) => void;
  applyError: (error: { code: string; message: string; hint: string }) => void;
  selectAgent: (agentId: string | null) => void;
  setHovered: (hovered: { id: string; x: number; y: number } | null) => void;
  focusPod: (pod: number | null) => void;
  openRail: (rail: OfficeStore["rail"]) => void;
  openOverlay: (overlay: OfficeStore["overlay"]) => void;
  addToolNotice: (notice: Omit<ToolNotice, "id">) => void;
  dismissToolNotice: (id: number) => void;
  trackTask: (reqId: string) => void;
  resolveTask: (reqId: string) => void;
  drainAnimations: () => AnimationCue[];
}

export const useOfficeStore = create<OfficeStore>((set, get) => ({
  connection: "connecting",
  state: undefined,
  mode: "demo",
  version: "",
  platform: "mac",
  editors: [],

  selectedAgentId: null,
  hovered: null,
  focusedPod: null,
  rail: "closed",
  overlay: "none",

  activity: [],
  animations: [],
  chats: {},
  runAgents: {},
  pendingTaskReqIds: new Set(),
  toolNotices: [],
  lastError: undefined,

  setConnection: (connection) => set({ connection }),

  // A welcome replaces everything: it is the office's own account of itself, and
  // anything this tab had inferred is stale by definition.
  applyWelcome: (state, mode, version, platform, editors) =>
    set({
      state,
      mode,
      version,
      connection: "open",
      ...(platform === undefined ? {} : { platform }),
      ...(editors === undefined ? {} : { editors }),
    }),

  applyState: (state) => set({ state }),

  applyEvent: (envelope, reducedMotion) => {
    const { activity, animations, chats, state, runAgents } = get();

    // Only `started` names its agent, so the run is remembered and every later
    // event about it can be attributed. Without this the feed says
    // " finished: Bakery tagline" with nobody's name in front of it.
    const event = envelope.event;
    const nextRunAgents =
      event.type === "started" ? { ...runAgents, [envelope.runId]: event.agentId } : runAgents;

    const agentForRun = nextRunAgents[envelope.runId];
    const nameOf = (agentId: string): string => {
      const id = agentId.length > 0 ? agentId : (agentForRun ?? "");
      return state?.agents.find((a) => a.id === id)?.name ?? id;
    };

    const ingested = ingestEvent(envelope, {
      ...(reducedMotion === undefined ? {} : { reducedMotion }),
      agentName: nameOf,
    });

    const fresh = dedupeCues(animations, ingested.cues);
    const seenActivity = new Set(activity.map((a) => a.id));
    const newActivity = ingested.activity.filter((a) => !seenActivity.has(a.id));

    // Streamed text becomes the agent's side of the chat as it arrives.
    let nextChats = chats;
    if (event.type === "chunk" || event.type === "started") {
      const runId = envelope.runId;
      const existing = chats[runId] ?? [];
      if (event.type === "started") {
        nextChats = {
          ...chats,
          [runId]: [...existing, { runId, role: "owner", text: event.prompt, at: envelope.at }],
        };
      } else {
        const last = existing.at(-1);
        nextChats =
          last?.role === "agent"
            ? {
                ...chats,
                [runId]: [...existing.slice(0, -1), { ...last, text: last.text + event.text }],
              }
            : {
                ...chats,
                [runId]: [...existing, { runId, role: "agent", text: event.text, at: envelope.at }],
              };
      }
    }

    set({
      activity: [...activity, ...newActivity].slice(-MAX_ACTIVITY),
      animations: [...animations, ...fresh].slice(-MAX_CUES),
      chats: nextChats,
      runAgents: nextRunAgents,
    });
  },

  applyError: (lastError) => set({ lastError }),

  // One card per file: a watcher that fires twice on one save should not stack
  // two identical cards for the owner to dismiss.
  addToolNotice: (notice) => {
    const { toolNotices } = get();
    const id = (toolNotices.at(-1)?.id ?? 0) + 1;
    set({ toolNotices: [...toolNotices.filter((n) => n.file !== notice.file), { ...notice, id }] });
  },

  dismissToolNotice: (id) =>
    set({ toolNotices: get().toolNotices.filter((notice) => notice.id !== id) }),

  selectAgent: (selectedAgentId) => set({ selectedAgentId }),
  setHovered: (hovered) => set({ hovered }),
  focusPod: (focusedPod) => set({ focusedPod }),
  openRail: (rail) => set({ rail }),
  openOverlay: (overlay) => set({ overlay }),

  trackTask: (reqId) => set({ pendingTaskReqIds: new Set([...get().pendingTaskReqIds, reqId]) }),
  resolveTask: (reqId) => {
    const next = new Set(get().pendingTaskReqIds);
    next.delete(reqId);
    set({ pendingTaskReqIds: next });
  },

  /** The scene takes cues once; leaving them would replay every frame. */
  drainAnimations: () => {
    const { animations } = get();
    if (animations.length > 0) set({ animations: [] });
    return animations;
  },
}));
