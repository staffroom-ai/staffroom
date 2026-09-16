# Office UI: the 3D office and HUD (`packages/web`)

Status: draft 2, 15 Sep 2026 (reconciled). Owner: web package maintainer.

This spec covers everything the user sees in the browser: the isometric office, the HUD around it, the list view that mirrors the scene, demo mode, and the state layer that drives all of it. It does not cover the server (`server-cli-runtime.md`), the agent loop (`core-agent-loop.md`), or the brain index (`brain.md`).

This spec owns: `OfficeState` and every type inside it (`packages/core/src/office-state.ts`), the scene-reaction table for run events, the `data-testid` contract the smoke test uses, and the performance budget numbers. WebSocket message types are owned by `server-cli-runtime.md` §6; this spec only says which ones the web sends and reads.

## Decisions

- The web package is a render layer over one `OfficeState` object received over WebSocket. It holds no business state of its own. A contributor could replace React Three Fiber with a 2D canvas by rewriting `src/scene/` and touching nothing else.
- State arrives as full snapshots (`state` messages), never patches. 35 agents is small; a snapshot is under 20 KB.
- Layout is fixed: six department pods in a ring around a central Brain, 35 agent seats. Not configurable in v1.
- One low-poly style, one shared material, instanced meshes for every repeated object. Draw-call budget is 60 per frame.
- Performance target: 60 fps with 35 agents on a 2020 MacBook Air. Bundle under 1.5 MB gzipped. Asserted in CI (`repo-quality-launch.md` §5 owns the job layout; this spec owns the numbers).
- Every element in the scene has a list-view twin. The list view is the default under 768 px and for screen readers, and can be toggled at any size with `L`.
- Zustand holds the store. Run events drive scene animation through a queue, never by mutating three.js objects from React render.
- Demo mode is the server running a demo provider adapter through the real loop; the web has no demo-specific code paths beyond a chip and a speed control.
- A non-developer can add a model key, rename an agent, revise a deliverable and recover from a closed Terminal without opening a file or a second Terminal window.
- Theme follows the system with a manual override, using the same CSS tokens as the product plan.

## 1. The OfficeState contract

The server sends a full `OfficeState` in `welcome`, then a fresh `state` whenever anything changes (coalesced at 250 ms), then run events as they happen. The web treats the latest `state` as the single source of truth and run events as animation hints.

```ts
// packages/core/src/office-state.ts (exported by core, built by server ws/state.ts, consumed by web)
export type AgentStatus = "idle" | "working" | "waiting_approval" | "error";
export type ModelStatus = "ok" | "no_key" | "unreachable";

export interface OfficeState {
  version: 1;
  mode: "live" | "demo";
  officeName: string;                    // agents.yaml: office.name
  timezone: string;                      // agents.yaml: office.timezone
  clock: string;                         // ISO 8601, server time, resent every 30 s
  defaultModel: string | null;           // agents.yaml: default_model
  departments: Department[];             // 1 to 6, in order of first appearance in agents.yaml
  agents: Agent[];                       // up to 35
  connectors: Connector[];
  runs: ActiveRun[];                     // running or waiting; finished runs are not here
  approvals: PendingApproval[];
  routines: Routine[];
  latestDeliverables: DeliverableSummary[];   // last 5, newest first
}

export interface Department { id: string; name: string; leadAgentId: string | null; pod: 0 | 1 | 2 | 3 | 4 | 5 }

export interface Agent {
  id: string; name: string | null; role: string; does: string;
  departmentId: string;
  seat: number;                          // 0..5 within the pod, assigned by server
  model: string;                         // resolved model id
  modelSource: "agent" | "office_default" | "first_provider";
  modelStatus: ModelStatus;              // computed at boot and on config reload
  local: boolean;                        // model provider is Ollama or a localhost base_url
  tools: string[];                       // connector ids this agent may use, brain tools omitted
  status: AgentStatus;
  currentRunId: string | null;
  currentTask: string | null;            // first 140 chars
  lastActiveAt: string | null;
}

export interface Connector {
  id: string;                            // "notion", "lookup_order", "web_search"
  kind: "mcp" | "custom" | "builtin";
  label: string;
  health: "ok" | "starting" | "auth_required" | "down" | "load_failed" | "denied";
  message: string | null;                // owner-facing error text, already redacted
  toolCount: number;
  departments: string[] | "all";
  lastUsedAt: string | null;
  pulse: number;                         // calls in the last 60 s
}

export interface ActiveRun {
  id: string; kind: "task" | "route" | "chat" | "revise" | "routine";
  task: string; departmentId: string;
  agentId: string | null;                // null on the reception in-tray until the lead has picked
  status: "queued" | "running" | "waiting_approval";
  startedAt: string; modelOverride: string | null; routineId: string | null;
}

export interface PendingApproval {
  id: string; runId: string; agentId: string; agentName: string;
  tool: { name: string; source: "builtin" | "custom" | "mcp"; scope: "write" };
  preview: ApprovalPreview;              // exact type from tools-mcp-approvals.md §5
  requestedAt: string; expiresAt: string;
}

export interface Routine { id: string; label: string; agentId: string; cadence: string; nextRunAt: string; lastRunAt: string | null; paused: boolean }

export interface DeliverableSummary { runId: string; noteId: string; title: string; agentId: string; at: string; status: "draft" | "approved" | "sent" | "rejected" }
```

Rules the web package obeys:

1. Never derive persistent state locally. If the socket drops, the HUD shows "Reconnecting" and the scene freezes; on reconnect the store is replaced wholesale from `welcome.state`.
2. Never send anything except the client messages listed in section 7.
3. Seat and pod numbers come from the server so scene and list agree on order.

### Run events the web reacts to

`event` messages carry a `RunEventEnvelope` (`core-agent-loop.md`). The web ignores any type it does not know.

| event | scene reaction |
|---|---|
| `started` | on the route run: task card appears in the reception in-tray. On a worker run: card leaves the tray. |
| `routed` | the worker stands, walks to the pod lead's desk and back (1.2 s), badge turns amber. If the parent run was created from this browser's task bar (matching `reqId`), `selectAgent(toAgentId)` and open the Chat tab so streaming text is visible from the first chunk. Activity line: `Dana handed this to Priya: Write a two-line tagline...` |
| `tool_call` | connector logo pulses once; an icon floats above the monitor for 800 ms. For `egress: true` the Activity line reads `Priya sent 840 characters to notion`. |
| `tool_result` | monitor flashes green or red. `redactedCount > 0` adds "contains 1 redacted value" to the Activity line. |
| `chunk` | typing animation while chunks arrive; stops 500 ms after the last. |
| `approval_needed` | agent raises a hand at its desk, badge turns blue, Approvals tab count increments and the rail opens if collapsed. |
| `approval_resolved` | hand goes down; `deny` makes the agent shrug (600 ms). |
| `brain_note_written` | paper sprite flies from the desk to the Brain (900 ms). |
| `done` | agent returns to idle. For a task-bar run from this browser: rail opens on Chat with the deliverable card, camera focuses the worker for 2 s then returns. Route runs (`noteId: null`) produce no card. |
| `failed` | badge turns red; agent slumps until the next run or Dismiss in chat. `error.message` in the speech bubble, `error.hint` under it. |

## 2. Scene design

### Layout

The floor is a 24 by 24 unit square. The Brain sits at the origin: a low glass cylinder (radius 2, height 1.2) with a slowly rotating ring of note cards inside it. Six pods sit on a ring of radius 8, at azimuths 0, 60, 120, 180, 240 and 300 degrees. Each pod is a raised platform (6 by 4 units) with a department label on the floor and a colour stripe on its front edge.

Seat count is 35 on purpose. Pods 0 to 4 have six desks in two rows of three. Pod 5, nearest the entrance at azimuth 300 degrees, has five desks plus the reception desk, where queued tasks appear as papers in an in-tray. The server enforces the seat limits (`AGENT_SEAT_LIMIT`, `server-cli-runtime.md` §4).

Department to pod assignment is by order of first appearance in `agents.yaml`. Unused pods render at 40 percent opacity with no label.

### Meshes

Everything is low-poly and flat-shaded. Triangle budget for the whole scene, 35 agents included, is 150,000; the worst case below is under 30,000.

| object | count | tris each | how drawn |
|---|---|---|---|
| desk, chair, monitor | 36 each | 60 / 80 / 40 | `<Instances>` from drei; monitor has an emissive channel per instance |
| agent body | 35 | 320 | instanced skinned mesh, 4 bones |
| agent head | 35 | 120 | instanced, colour per department |
| status badge | 35 | 8 | instanced billboard quad with a glyph |
| local badge | 35 | 4 | small "local" pill shown when `agent.local` |
| pod platform | 6 | 24 | one merged geometry |
| Brain | 1 | 900 | single mesh plus 24 instanced cards |
| floor, walls, entrance | 1 | 200 | one merged geometry |
| paper sprite | pool of 8 | 2 | billboard, reused |

One `MeshToonMaterial` with vertex colours and per-instance `instanceColor`; the Brain uses a transparent glass material; paper sprites an unlit one. Three materials is the ceiling.

Agent walking uses a precomputed path table with three walks: seat to pod lead's desk, back, and seat to reception (only for a lead picking up a queued task). Straight lines, 0.3 unit corner radius, no pathfinding.

### Camera

An `OrthographicCamera` at 35.264 degrees elevation. Overview (`0` or `Home`): azimuth 45, frustum fits the floor plus margin; `Q` and `E` orbit between the four diagonals over 400 ms. Focus on agent (click, or `Enter` in the list): target moves to the desk, frustum tightens to 9 units over 500 ms, the rail opens on that agent's chat; `Esc` returns. Focus on pod (click a label): 12 units on the pod centre. Scroll zooms between the two frustums; drag pans within the floor. `prefers-reduced-motion` removes walks, hand-raises and paper flights; status changes become instant badge changes.

### Picking

No raycasting. Each agent and desk registers a screen-space rectangle each frame from its projected bounds in `useFrame`, stored in a plain array on the store. Hover and click resolve against that array, which is testable in Vitest without WebGL.

## 3. Performance budget

Budget, asserted by `e2e/office-perf.spec.ts` in the `perf` CI job (`repo-quality-launch.md` §5, `macos-14` runner):

| metric | limit | how measured |
|---|---|---|
| bundle, gzipped | 1.5 MB total; main chunk 600 KB | `size-limit` on `packages/web/dist/**/*.js` |
| draw calls per frame | 60 | `window.__staffroom.renderInfo.calls` after 5 s in demo mode |
| triangles per frame | 150,000 | `renderInfo.triangles` |
| p95 frame time | 8 ms on `macos-14` (Apple Silicon) | ring buffer of `useFrame` deltas, warm-up 3 s, record 10 s with 35 agents cycling demo runs |
| time to first rendered frame | 2.0 s cold | `performance.mark("office:first-frame")` |

The 8 ms limit on Apple Silicon keeps the same margin the 16.7 ms target has on the 2020 Air's Iris Plus; the reasoning is a comment in the test file. `window.__staffroom` (`renderInfo`, `frameTimes`, `store`) exists only when `import.meta.env.MODE !== "production"` or with `?perf=1`.

Bundle rules: `three` imported by path where it works; drei per helper, never the barrel; no GLTF loader; no font files in the scene (labels are drei `<Html>` with system fonts); HUD fonts are system stacks.

## 4. HUD panels

CSS grid: top bar (48 px), main area, task bar (72 px), right rail (360 px, collapsible).

### Top bar

- Office name and mode chip. In demo mode the amber chip's tooltip reads: `Sample office, no keys needed. Click Settings > Models to add a key and go live.` In live mode: `Live: 4 agents on claude-sonnet-5`.
- Connector strip: one 24 px logo per connector, ordered by kind then `lastUsedAt`. Health dot: green `ok`, grey `starting`, amber `auth_required` with a Connect button that sends `mcp.oauth.begin` and opens `mcp.oauth.url` in a new tab, red `down` or `load_failed` with `message` on hover and in the Activity card, struck-through `denied` with a lock. `pulse > 0` adds a ring. Hover shows label, kind, `toolCount`, departments, last used.
- Models in use: a chip per distinct model with a count. The popover lists agents with `modelSource` explained in words: `agent` as "set on this agent in agents.yaml", `office_default` as "office default", `first_provider` as "no default set; using the first provider with a key". Agents with `modelStatus !== "ok"` show a grey badge with tooltip `Sam needs an OpenAI key. Open Settings > Models.` before any task is given.
- Clock, theme toggle, `?` for the keyboard map, and a Settings gear.

### Settings > Models

A panel, not a file. One row per provider in `config.yaml` (Anthropic, OpenAI, OpenAI-compatible, Ollama): a masked "Paste an API key" field, a Test button, and the result. Test sends `provider.set_key { provider, key }`; the server runs the same one-token completion as `npx staffroom setup`, writes `office/.env`, re-runs boot in place, and replies `config.reloaded { file: ".env" }` followed by a fresh `state` with `mode: "live"`. The key is never echoed back. A failed test shows the `AUTH_FAILED` or `PROVIDER_UNAVAILABLE` hint inline. Below the rows: "Keys are saved to office/.env, a hidden file in your office folder." When the office leaves demo mode the sample-content question from `brain.md` ("Leaving demo mode") appears here once.

Settings also lists whitelist rows from `office/approvals.yaml` with Revoke buttons and shows `doctor --json` output.

### Task bar

Four controls and a button, in Tab order:

1. Department picker: segmented control in pod order. `Alt+1` to `Alt+6`.
2. Task field: single line, grows to three. Placeholder rotates through three examples from the template. `Enter` submits, `Shift+Enter` newlines. No prefixes, no slash commands; `revise:` lives in chat.
3. Model override: "Default (per agent)" plus every configured model. Choosing one sets `modelOverride` on this run only; the chip turns amber. Agents with `local: true` are refused by the server (`MODEL_OVERRIDE_LEAVES_MACHINE`) and the error shows inline.
4. Schedule: "Now", "Every weekday at", "Every day at", "Every week on", plus a time. Anything except Now creates a routine (`server-cli-runtime.md` §7) and the task bar shows a calendar icon on submit.
5. Send button, "Give task".

Submitting sends `task.create { reqId, department, text, modelOverride?, schedule? }`. The field clears on `ack`; the `routed` and `done` reactions in section 1 use the `reqId` to open the right chat. An `error` shows inline with the server's `hint` verbatim.

### Right rail

Three tabs, `Alt+C` `Alt+A` `Alt+P`.

Chat: per-agent. The header shows name, role, model chip, `local` pill, status. The name is editable (click or `Enter`, 1 to 40 characters); it sends `agent.rename { agentId, name }` and the roster updates on `config.reloaded`. A popover next to it says: "To change role or model, edit office/agents.yaml." History is rebuilt from `runs.replay` of this agent's `chat` and `revise` runs (`started.prompt` as the owner's line, `chunk`s coalesced as the reply); the current run streams live. A `done` on a task, routine or revise run renders a deliverable card: title, body, `Open in brain` (opens the note in the side sheet), `Approve` (flips the note's `status` from `draft` to `approved`, the owner's first approval), `Show in Finder`, and `Revise`, which focuses the chat box prefilled with `revise: `. When the agent has a deliverable the header also shows "Revise last result". Sending emits `chat.send { agentId, text }`; on `NOTHING_TO_REVISE` the chat shows the hint "Give them a task first."

Activity: reverse-chronological feed of every event in the section 1 table, in words, plus the server-pushed cards: tool load failures with a Copy button, "has no scope" warnings, "New tool lookup_order is ready. Who may use it?" with agent checkboxes, and `brain.warning`s. Filterable by agent, department or connector.

Approvals: one card per `PendingApproval`: agent name and role, `preview.action`, `preview.destination`, `preview.summary`, `preview.body` in a monospace scroll box, `preview.fields` with `sensitive` values as `••••`. A red banner when `preview.irreversible`: "This cannot be undone once sent." An amber line when `preview.changedSinceAllowed`: "This tool changed since you allowed it." For MCP tools the verbatim line from `tools-mcp-approvals.md` §5 ("Staffroom cannot see what this server will do with the request..."). Three buttons: `Approve once`, `Approve and always allow (90 days)`, `Deny` with an optional note. Approve-always opens a small confirm showing the prefilled match, worded with the action and full tool name: "Always allow Priya to Send an email (gmail.send_email) to *@acme.com", and sends `approval.decide { approvalId, decision: "approve_always", match }`. Buttons never fire on a single keypress: `A`, `S` or `R`, then `Enter`. The tab label carries the count.

### Brain graph overlay, `G`

Fades the scene to 20 percent and draws a 2D SVG force graph from `brain.graph.get`, patched live by `brain.note.indexed` and `brain.note.removed`. Nodes coloured by `writtenBy`, `sample` nodes dimmed, `status` as a ring, the last five deliverables highlighted. Click opens the note in a side sheet with rendered markdown, `Show in Finder`, and `Open in editor` only when Obsidian, VS Code or Typora is detected. Search box uses `brain.search` with 150 ms debounce. Tab moves between nodes, `Enter` opens.

### Disconnected

`ws.ts` reconnects with backoff 500 ms to 8 s. After 10 s of failed reconnects the scene greys to 40 percent and a banner reads: `Staffroom has stopped on this Mac. Open Terminal and run: npx staffroom` with a Copy button. Retrying continues every 8 s; the banner clears on `welcome`.

### Keyboard map

| key | action |
|---|---|
| `T` | focus task field |
| `G` | brain graph overlay |
| `L` | toggle list view |
| `/` | focus activity search |
| `Q` `E` | orbit left, right |
| `0` `Home` | overview |
| `Esc` | close overlay, then release focus, then overview |
| `Alt+1`..`Alt+6` | pick department |
| `Alt+C` `Alt+A` `Alt+P` | chat, activity, approvals tab |
| `[` `]` | previous, next agent |
| `Enter` on agent | focus camera and open chat |
| `A`, `S`, `R` then `Enter` | approve once, approve always, deny the focused approval |
| `?` | this map |
| `D` | demo speed (demo mode only): 1x, 2x, 4x |

Generated from one `keymap.ts` table that both the handler and the help dialog read.

## 5. List view

The accessible twin and small-screen default; also what the smoke test asserts against.

- A "Latest results" section first: the five `latestDeliverables` with agent, title, time and status, each a link to the note.
- One `<section>` per department in pod order, heading is the department name with the lead named. A table: Name (editable, same `agent.rename`), Role, Status (text plus icon), Current task, Model (with the `local` pill and `modelStatus` badge), Connectors. Rows are focusable; `Enter` opens chat.
- A "Reception" section listing queued runs (`agentId === null`).
- Top bar, rail and task bar unchanged.

Below 768 px the list view is forced. Between 768 and 1024 px the choice is remembered in `localStorage` under `staffroom.view`. The canvas carries `aria-hidden="true"`; a visually hidden `aria-live="polite"` region announces status changes, throttled to one per agent per 5 s. "Skip to list view" is the first focusable element.

### Test hooks

These attributes are a contract with `e2e/smoke.spec.ts` (`repo-quality-launch.md` §4) and cannot be renamed without changing that file:

- `data-testid="agent-<id>"` on each list row, with `data-state` equal to `Agent.status`.
- `data-testid="deliverable-latest"` on the first item of "Latest results".
- Each "Latest results" item is a `listitem` whose accessible name starts with `Written by <agent name>`.
- The task bar's department picker is a `combobox` named "Department"; the task field is a `textbox` named "Task".

## 6. Demo mode

When `state.mode === "demo"` the server runs `FixtureAdapter` against the studio's `demo-runs/*.jsonl` through the real loop (`server-cli-runtime.md` §9). The web does three things:

1. Shows the amber "Demo" chip with the tooltip from section 4.
2. Adds the `D` speed control, sending `demo.speed { factor }`. The server scales the adapter's per-chunk delay; nothing is fast-forwarded locally.
3. Accepts tasks normally. The task bar shows "Demo runs are pre-recorded." under the field.

Connectors the sample runs reference appear in the top bar with `health: "ok"` and pulse like real ones. The README GIF is recorded from demo mode at 2x.

## 7. State management

One Zustand store in `packages/web/src/store.ts`, plus `src/ws.ts`.

```ts
interface OfficeStore {
  connection: "connecting" | "open" | "reconnecting" | "stopped";   // stopped = banner shown
  state: OfficeState | null;
  selectedAgentId: string | null;
  view: "scene" | "list";
  rail: { open: boolean; tab: "chat" | "activity" | "approvals" };
  overlay: "none" | "graph" | "keymap" | "settings";
  camera: { mode: "overview" | "agent" | "pod"; target: string | null; azimuth: 45 | 135 | 225 | 315 };
  chats: Record<string, ChatMessage[]>;      // by agentId, capped at 200
  activity: ActivityLine[];                  // capped at 500
  animations: AnimationCue[];
  pendingTaskReqIds: Set<string>;            // task.create reqIds from this tab, for the routed/done reactions
  theme: "system" | "light" | "dark";
  demoSpeed: 1 | 2 | 4;

  applyState(s: OfficeState): void;
  ingestEvent(e: RunEventEnvelope): void;
  send(cmd: ClientMessage): void;            // the subset below
  selectAgent(id: string | null): void;
  focusAgent(id: string): void;
  setView(v: "scene" | "list"): void;
}

interface AnimationCue {
  id: string;                  // envelope seq, so a replayed event is not animated twice
  agentId: string;
  kind: "walk_to_lead" | "walk_back" | "type_start" | "type_stop" | "raise_hand" | "lower_hand" | "shrug" | "slump" | "paper_to_brain" | "monitor_flash" | "connector_pulse";
  at: number;
  payload?: { connectorId?: string; ok?: boolean };
}
```

Client messages the web sends, all defined in `server-cli-runtime.md` §6: `hello`, `task.create`, `task.cancel`, `chat.send`, `approval.decide`, `agent.rename`, `provider.set_key`, `routine.upsert`, `routine.delete`, `routine.run_now`, `brain.search`, `brain.graph.get`, `runs.replay`, `mcp.reconnect`, `mcp.oauth.begin`, `tools.assign`, `demo.speed`, `ping`. Server messages it reads: `welcome`, `ack`, `error`, `state`, `event`, `replay`, `config.error`, `config.reloaded`, `tools.reloaded`, `mcp.status`, `mcp.tools_changed`, `mcp.oauth.url`, `brain.results`, `brain.graph`, `brain.note.indexed`, `brain.note.removed`, `brain.warning`, `pong`.

How run events reach the scene: `ws.ts` receives `event` and calls `ingestEvent`, which appends an Activity line, updates `chats` for `chunk` and `done`, and pushes `AnimationCue`s per the section 1 table. The scene's `<Agents>` `useFrame` drains `animations` into per-agent timelines in a `useRef` array and writes instance matrices; the store is read with `getState()` inside `useFrame`, not with a hook. Status colours come from `state.agents[i].status`, never from cues, so a missed cue can at worst skip an animation.

`ws.ts` reads the session token from the `staffroom-token` meta tag (or `?t=`), stores it in `sessionStorage`, and sends it in `hello`. Selectors in `src/selectors.ts` are the only way panels and scene read state.

## 8. Theming

CSS custom properties on `:root` with the product plan's token names. Light on bare `:root`, dark under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. The toggle writes `data-theme` on `<html>` and remembers it in `localStorage` under `staffroom.theme`. The scene reads the tokens once per theme change. Department colours by pod index: blue `#2457D6`/`#6A93FF`, green `#2A8A5B`/`#4CBF85`, amber `#B7791F`/`#E0A64A`, rose `#C0392B`/`#E86A5C`, violet `#6B4FBB`/`#A08CE6`, teal `#1F8A8A`/`#4FC3C3`. Status badges: idle `#8A8F9C`, working `#E0A64A`, waiting approval `#2457D6`, error `#C0392B`, each with a glyph.

## 9. Not customisable in v1

- Pod count (six), positions, ring layout.
- Seat count (35) and positions. The server rejects a seventh agent in a department with `Department marketing has 7 agents; pods hold 6 in v1.` and a sixth in the department that lands in pod 5 with `Department support has 6 agents but sits in the pod with the reception desk, which holds 5 in v1.`
- Desk, chair and agent models; no avatars or uploaded images.
- Camera angles beyond the four diagonals. HUD layout. Department colours (from pod index). Keyboard shortcuts.

Customisable: department ids and display names, agent names (in the UI or `agents.yaml`), roles, models and tools (`agents.yaml`), the office name (`agents.yaml`), theme, view, rail state.

## 10. Package layout

```
packages/web/
  src/
    main.tsx  App.tsx  ws.ts  store.ts  selectors.ts  keymap.ts  theme.ts
    scene/    Scene.tsx  Office.tsx  Agents.tsx  Desks.tsx  Papers.tsx  paths.ts  picking.ts
    hud/      TopBar.tsx  TaskBar.tsx  Rail.tsx  Chat.tsx  Activity.tsx  Approvals.tsx  Settings.tsx  GraphOverlay.tsx  KeymapDialog.tsx  StoppedBanner.tsx
    list/     ListView.tsx
  tests/      store.test.ts  picking.test.ts  selectors.test.ts
  e2e/        smoke.spec.ts  office-perf.spec.ts
  .size-limit.json
```

## Open questions

1. Should the reception desk animate a lead walking over to pick up the paper? Recommendation: in-tray only in v0.1; the lead walk is a v0.2 polish item.
2. Free orbit as a hidden setting for video recording? Recommendation: no. Ship `?azimuth=` accepting the four diagonals only.
3. Brain graph inside the 3D scene instead of SVG? Recommendation: SVG; keyboard reachable and costs nothing.
4. Should `Approve and always allow` be visible in the demo? Recommendation: yes, and the server honours it in demo mode too (it writes `approvals.yaml` like anything else) so the demo does not lie; the sample-content cleanup on going live does not touch that file.
5. Should the Settings panel also edit `default_model`? Recommendation: yes in v0.2, as one select that writes `agents.yaml` through the same document-mode writer as rename; roles, tools and per-agent models stay YAML-only until v0.3.
