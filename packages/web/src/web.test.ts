import type { OfficeState, RunEventEnvelope } from "@staffroom/core";
import { beforeEach, describe, expect, it } from "vitest";
import { dedupeCues, ingestEvent } from "./cues.js";
import { bindingFor, chordFor, groups, KEYMAP } from "./keymap.js";
import {
  distanceOf,
  FLOOR_SIZE,
  POD_RING_RADIUS,
  pathBetween,
  podColour,
  podPosition,
  pointAlong,
  seatPosition,
  seatsInPod,
} from "./layout.js";
import {
  agentOrder,
  agentsInPod,
  nextApproval,
  positionOf,
  stepAgent,
  usedPods,
} from "./selectors.js";
import { useOfficeStore } from "./store.js";
import { backoffFor, readToken } from "./ws.js";

const agent = (
  id: string,
  departmentId: string,
  seat: number,
  over: Record<string, unknown> = {},
) =>
  ({
    id,
    name: id,
    role: "R",
    does: "d",
    departmentId,
    seat,
    model: "demo/demo",
    modelSource: "office_default",
    modelStatus: "ok",
    local: false,
    tools: [],
    status: "idle",
    currentRunId: null,
    currentTask: null,
    lastActiveAt: null,
    ...over,
  }) as OfficeState["agents"][number];

const state = (over: Partial<OfficeState> = {}): OfficeState => ({
  version: 1,
  mode: "demo",
  officeName: "Northlight",
  timezone: "Australia/Melbourne",
  clock: "2026-09-16T00:00:00Z",
  defaultModel: "demo/demo",
  departments: [
    { id: "marketing", name: "Marketing", leadAgentId: "lead", pod: 0 },
    { id: "finance", name: "Finance", leadAgentId: "book", pod: 1 },
  ],
  agents: [
    agent("lead", "marketing", 0),
    agent("priya", "marketing", 1),
    agent("book", "finance", 0),
  ],
  connectors: [],
  runs: [],
  approvals: [],
  routines: [],
  latestDeliverables: [],
  ...over,
});

const envelope = (
  event: RunEventEnvelope["event"],
  seq = 1,
  runId = "run_1",
): RunEventEnvelope => ({
  seq,
  runId,
  at: 1_700_000_000_000,
  event,
});

describe("the floor plan", () => {
  it("puts six pods on a ring around the brain", () => {
    for (let pod = 0; pod < 6; pod++) {
      const { x, z } = podPosition(pod);
      expect(Math.hypot(x, z)).toBeCloseTo(POD_RING_RADIUS, 2);
    }
  });

  it("keeps every pod inside the floor", () => {
    for (let pod = 0; pod < 6; pod++) {
      for (let seat = 0; seat < 6; seat++) {
        const { x, z } = seatPosition(pod, seat);
        expect(Math.abs(x), `pod ${pod} seat ${seat}`).toBeLessThan(FLOOR_SIZE / 2);
        expect(Math.abs(z), `pod ${pod} seat ${seat}`).toBeLessThan(FLOOR_SIZE / 2);
      }
    }
  });

  it("gives every seat in a pod its own spot", () => {
    const seen = new Set<string>();
    for (let pod = 0; pod < 6; pod++) {
      for (let seat = 0; seat < 6; seat++) {
        const { x, z } = seatPosition(pod, seat);
        const key = `${x},${z}`;
        expect(seen.has(key), `pod ${pod} seat ${seat} collides`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("seats one fewer in the pod with the reception desk", () => {
    expect(seatsInPod(4)).toBe(5);
    expect(seatsInPod(0)).toBe(6);
  });

  it("gives each pod its own colour", () => {
    expect(new Set([0, 1, 2, 3, 4, 5].map(podColour)).size).toBe(6);
  });

  it("is stable, so a rebuild does not move the furniture", () => {
    expect(seatPosition(2, 3)).toEqual(seatPosition(2, 3));
    expect(podPosition(0)).toMatchSnapshot();
  });
});

describe("walking", () => {
  it("turns a corner rather than cutting across the floor", () => {
    const path = pathBetween({ x: 0, z: 0 }, { x: 4, z: 6 });
    expect(path).toHaveLength(3);
    expect(path[1]).toEqual({ x: 0, z: 6 });
  });

  it("goes straight when it can", () => {
    expect(pathBetween({ x: 0, z: 0 }, { x: 0, z: 5 })).toHaveLength(2);
  });

  it("measures the whole walk", () => {
    expect(distanceOf(pathBetween({ x: 0, z: 0 }, { x: 3, z: 4 }))).toBe(7);
  });

  it("starts at the start and ends at the end", () => {
    const path = pathBetween({ x: 0, z: 0 }, { x: 4, z: 6 });
    expect(pointAlong(path, 0)).toEqual({ x: 0, z: 0 });
    expect(pointAlong(path, 1)).toEqual({ x: 4, z: 6 });
  });

  it("moves steadily along the way", () => {
    const path = pathBetween({ x: 0, z: 0 }, { x: 0, z: 10 });
    expect(pointAlong(path, 0.5)).toEqual({ x: 0, z: 5 });
  });

  it("survives a walk to where it already is", () => {
    const path = pathBetween({ x: 2, z: 2 }, { x: 2, z: 2 });
    expect(pointAlong(path, 0.5)).toEqual({ x: 2, z: 2 });
  });
});

describe("cues", () => {
  it("raises a hand when the office needs the owner", () => {
    const { cues, activity } = ingestEvent(
      envelope({
        type: "approval_needed",
        approvalId: "apr_1",
        toolCallId: "c1",
        tool: { name: "send_sms", source: { kind: "custom", file: "f.ts" }, scope: "write" },
        input: {},
        preview: { action: "Send", destination: "x", summary: "s", body: "b", irreversible: true },
        requestedAt: 1,
        expiresAt: 2,
      }),
    );
    expect(cues.map((c) => c.kind)).toEqual(["raise_hand"]);
    expect(activity[0]).toMatchObject({ tone: "waiting" });
  });

  it("flies a paper to the brain when a note is written", () => {
    const { cues } = ingestEvent(
      envelope({
        type: "brain_note_written",
        noteId: "40-deliverables/marketing/x",
        status: "draft",
      }),
    );
    expect(cues.map((c) => c.kind)).toEqual(["paper_to_brain"]);
  });

  it("slumps on a failure and says why", () => {
    const { cues, activity } = ingestEvent(
      envelope({
        type: "failed",
        error: { code: "MAX_TURNS", message: "Priya did not finish.", hint: "h", detail: {} },
        partialText: null,
        turns: 12,
      }),
    );
    expect(cues.map((c) => c.kind)).toEqual(["type_stop", "slump"]);
    expect(activity[0]).toMatchObject({ text: "Priya did not finish.", tone: "bad" });
  });

  it("names the connector a tool call went through", () => {
    const { cues } = ingestEvent(
      envelope({
        type: "tool_call",
        turn: 1,
        call: { id: "c1", name: "notion.search_pages", input: {} },
        scope: "read",
        egress: true,
        inputChars: 840,
        group: "g1",
      }),
    );
    expect(cues[0]).toMatchObject({ kind: "connector_pulse", connectorId: "notion.search_pages" });
  });

  it("says how much left the machine on an egress read", () => {
    const { activity } = ingestEvent(
      envelope({
        type: "tool_call",
        turn: 1,
        call: { id: "c1", name: "notion.search_pages", input: {} },
        scope: "read",
        egress: true,
        inputChars: 840,
        group: "g1",
      }),
      { agentName: () => "Priya" },
    );
    expect(activity[0]?.text).toBe("Priya sent 840 characters to notion.search_pages.");
  });

  it("produces no animation at all when the viewer asked for less motion", () => {
    const { cues, activity } = ingestEvent(
      envelope({ type: "brain_note_written", noteId: "n", status: "draft" }),
      { reducedMotion: true },
    );
    expect(cues).toEqual([]);
    // The information is still there; only the movement is gone.
    expect(activity).toHaveLength(1);
  });

  it("ignores an event the office has nothing to show for", () => {
    const { cues, activity } = ingestEvent(
      envelope({ type: "brain_pinned_included", noteIds: ["00-about/a"] }),
    );
    expect(cues).toEqual([]);
    expect(activity).toEqual([]);
  });

  it("replays the same envelope without animating it twice", () => {
    const one = ingestEvent(
      envelope({ type: "brain_note_written", noteId: "n", status: "draft" }, 7),
    );
    const again = ingestEvent(
      envelope({ type: "brain_note_written", noteId: "n", status: "draft" }, 7),
    );
    expect(dedupeCues(one.cues, again.cues)).toEqual([]);
  });
});

describe("the store", () => {
  beforeEach(() => {
    useOfficeStore.setState({
      connection: "connecting",
      state: undefined,
      activity: [],
      animations: [],
      chats: {},
      selectedAgentId: null,
      rail: "closed",
      overlay: "none",
      pendingTaskReqIds: new Set(),
    });
  });

  it("takes the office's own account of itself wholesale", () => {
    useOfficeStore.getState().applyWelcome(state(), "demo", "0.1.0");
    expect(useOfficeStore.getState().state?.officeName).toBe("Northlight");
    expect(useOfficeStore.getState().connection).toBe("open");
  });

  it("keeps the last snapshot when the socket drops", () => {
    useOfficeStore.getState().applyWelcome(state(), "demo", "0.1.0");
    useOfficeStore.getState().setConnection("reconnecting");
    // The office is stale, not gone: better to show it greyed than to show nothing.
    expect(useOfficeStore.getState().state).toBeDefined();
    expect(useOfficeStore.getState().connection).toBe("reconnecting");
  });

  it("builds the chat from what streamed", () => {
    const store = useOfficeStore.getState();
    store.applyWelcome(state(), "demo", "0.1.0");
    store.applyEvent(
      envelope(
        {
          type: "started",
          agentId: "priya",
          kind: "task",
          model: { provider: "demo", model: "demo" },
          modelSource: "office_default",
          prompt: "Write a tagline",
          parentRunId: null,
          routineId: null,
          systemPromptHash: "h",
          toolNames: [],
        },
        1,
      ),
    );
    store.applyEvent(envelope({ type: "chunk", turn: 1, attempt: 1, text: "Baked " }, 2));
    store.applyEvent(envelope({ type: "chunk", turn: 1, attempt: 1, text: "fresh." }, 3));

    const turns = useOfficeStore.getState().chats["run_1"] ?? [];
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "owner", text: "Write a tagline" });
    expect(turns[1]).toMatchObject({ role: "agent", text: "Baked fresh." });
  });

  it("hands each cue to the scene once", () => {
    const store = useOfficeStore.getState();
    store.applyWelcome(state(), "demo", "0.1.0");
    store.applyEvent(envelope({ type: "brain_note_written", noteId: "n", status: "draft" }, 5));

    expect(useOfficeStore.getState().drainAnimations()).toHaveLength(1);
    expect(useOfficeStore.getState().drainAnimations()).toHaveLength(0);
  });

  it("tracks a task until the office answers", () => {
    const store = useOfficeStore.getState();
    store.trackTask("t1");
    expect(useOfficeStore.getState().pendingTaskReqIds.has("t1")).toBe(true);
    store.resolveTask("t1");
    expect(useOfficeStore.getState().pendingTaskReqIds.has("t1")).toBe(false);
  });
});

describe("selectors", () => {
  const s = state();

  it("lists a pod in seat order", () => {
    expect(agentsInPod(s, 0).map((a) => a.id)).toEqual(["lead", "priya"]);
  });

  it("knows which pods are in use, so the rest can dim", () => {
    expect(usedPods(s)).toEqual([0, 1]);
  });

  it("finds where someone sits", () => {
    expect(positionOf(s, "priya")).toEqual(seatPosition(0, 1));
    expect(positionOf(s, "nobody")).toBeUndefined();
  });

  it("walks the office in pod then seat order", () => {
    expect(agentOrder(s)).toEqual(["lead", "priya", "book"]);
    expect(stepAgent(s, "priya", 1)).toBe("book");
    expect(stepAgent(s, "book", 1)).toBe("lead");
    expect(stepAgent(s, "lead", -1)).toBe("book");
    expect(stepAgent(s, null, 1)).toBe("lead");
  });

  it("offers the approval that has waited longest", () => {
    const withApprovals = state({
      approvals: [
        {
          id: "b",
          runId: "r",
          agentId: "priya",
          agentName: "Priya",
          tool: { name: "t", source: "custom", scope: "write" },
          preview: { action: "a", destination: "d", summary: "s", body: "b", irreversible: true },
          requestedAt: "2026-09-16T01:00:00Z",
          expiresAt: "2026-09-17T01:00:00Z",
        },
        {
          id: "a",
          runId: "r",
          agentId: "priya",
          agentName: "Priya",
          tool: { name: "t", source: "custom", scope: "write" },
          preview: { action: "a", destination: "d", summary: "s", body: "b", irreversible: true },
          requestedAt: "2026-09-16T00:00:00Z",
          expiresAt: "2026-09-17T00:00:00Z",
        },
      ],
    });
    expect(nextApproval(withApprovals)?.id).toBe("a");
  });
});

describe("the keymap", () => {
  it("is the only place a shortcut is defined", () => {
    expect(bindingFor("Q", false)?.label).toBe("Turn the office left");
    expect(bindingFor("G", false)?.label).toBe("Open the brain");
  });

  it("hides demo-only keys outside demo mode", () => {
    expect(bindingFor("D", false)).toBeUndefined();
    expect(bindingFor("D", true)?.group).toBe("Demo");
  });

  it("makes approval a two-key chord, so one keystroke cannot send anything", () => {
    expect(bindingFor("A", false)).toBeUndefined();
    expect(chordFor("A", false)?.label).toBe("Approve what is waiting");
    expect(chordFor("A", false)?.chord).toBe("Enter");
  });

  it("gives every binding a label for the help dialog", () => {
    for (const binding of KEYMAP) {
      expect(binding.label.length, binding.keys).toBeGreaterThan(3);
      expect(groups()).toContain(binding.group);
    }
  });
});

describe("the connection", () => {
  it("backs off, but not forever", () => {
    expect(backoffFor(1)).toBe(500);
    expect(backoffFor(2)).toBe(1000);
    expect(backoffFor(20)).toBe(8000);
  });

  it("prefers the token the office put in the page", () => {
    document.head.innerHTML = '<meta name="staffroom-token" content="from-page">';
    expect(readToken(document, "http://localhost:4242/?t=from-url")).toBe("from-page");
    document.head.innerHTML = "";
  });

  it("takes a pasted link's token and keeps it for the session", () => {
    expect(readToken(document, "http://localhost:4242/?t=from-url")).toBe("from-url");
    expect(sessionStorage.getItem("staffroom-token")).toBe("from-url");
  });

  it("has nothing to offer when there is no token anywhere", () => {
    sessionStorage.clear();
    expect(readToken(document, "http://localhost:4242/")).toBeUndefined();
  });
});

describe("attributing events to people", () => {
  beforeEach(() => {
    useOfficeStore.setState({
      state: undefined,
      activity: [],
      animations: [],
      chats: {},
      runAgents: {},
    });
  });

  it("names the agent on every line of a run, not only the first", () => {
    const store = useOfficeStore.getState();
    store.applyWelcome(state(), "demo", "0.1.0");

    store.applyEvent(
      envelope(
        {
          type: "started",
          agentId: "priya",
          kind: "task",
          model: { provider: "demo", model: "demo" },
          modelSource: "office_default",
          prompt: "go",
          parentRunId: null,
          routineId: null,
          systemPromptHash: "h",
          toolNames: [],
        },
        1,
      ),
    );
    // `done` carries no agentId of its own, which is what made the feed read
    // " finished: ..." with nobody's name in front of it.
    store.applyEvent(
      envelope(
        {
          type: "done",
          deliverable: { title: "Bakery tagline", text: "t", noteId: "n/1" },
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: null,
          toolsUsed: [],
          turns: 1,
        },
        2,
      ),
    );

    const lines = useOfficeStore.getState().activity.map((a) => a.text);
    expect(lines[0]).toBe("priya started work.");
    expect(lines[1]).toBe("priya finished: Bakery tagline");
  });

  it("keeps runs apart", () => {
    const store = useOfficeStore.getState();
    store.applyWelcome(state(), "demo", "0.1.0");

    const started = (agentId: string, seq: number, runId: string): RunEventEnvelope =>
      envelope(
        {
          type: "started",
          agentId,
          kind: "task",
          model: { provider: "demo", model: "demo" },
          modelSource: "office_default",
          prompt: "go",
          parentRunId: null,
          routineId: null,
          systemPromptHash: "h",
          toolNames: [],
        },
        seq,
        runId,
      );

    store.applyEvent(started("lead", 1, "run_a"));
    store.applyEvent(started("priya", 2, "run_b"));
    store.applyEvent(
      envelope(
        {
          type: "done",
          deliverable: { title: "X", text: "t", noteId: "n/2" },
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: null,
          toolsUsed: [],
          turns: 1,
        },
        3,
        "run_a",
      ),
    );

    expect(useOfficeStore.getState().activity.at(-1)?.text).toBe("lead finished: X");
  });
});
