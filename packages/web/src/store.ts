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

  selectedAgentId: string | null;
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
  lastError: { code: string; message: string; hint: string } | undefined;

  setConnection: (connection: Connection) => void;
  applyWelcome: (state: OfficeState, mode: "live" | "demo", version: string) => void;
  applyState: (state: OfficeState) => void;
  applyEvent: (envelope: RunEventEnvelope, reducedMotion?: boolean) => void;
  applyError: (error: { code: string; message: string; hint: string }) => void;
  selectAgent: (agentId: string | null) => void;
  focusPod: (pod: number | null) => void;
  openRail: (rail: OfficeStore["rail"]) => void;
  openOverlay: (overlay: OfficeStore["overlay"]) => void;
  trackTask: (reqId: string) => void;
  resolveTask: (reqId: string) => void;
  drainAnimations: () => AnimationCue[];
}

export const useOfficeStore = create<OfficeStore>((set, get) => ({
  connection: "connecting",
  state: undefined,
  mode: "demo",
  version: "",

  selectedAgentId: null,
  focusedPod: null,
  rail: "closed",
  overlay: "none",

  activity: [],
  animations: [],
  chats: {},
  runAgents: {},
  pendingTaskReqIds: new Set(),
  lastError: undefined,

  setConnection: (connection) => set({ connection }),

  // A welcome replaces everything: it is the office's own account of itself, and
  // anything this tab had inferred is stale by definition.
  applyWelcome: (state, mode, version) => set({ state, mode, version, connection: "open" }),

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

  selectAgent: (selectedAgentId) => set({ selectedAgentId }),
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
