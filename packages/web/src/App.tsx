/**
 * The office, top to bottom.
 *
 * Three layers: the model, the cards that read it, and the rail that says what
 * actually happened. Everything reads from the store, which holds the office's own
 * account of itself; nothing here decides anything on its own.
 */
import type { BrainGraph } from "@staffroom/core";
import {
  lazy,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { applyIndexed, applyRemoved } from "./graph/patch.js";
import { acceptsUpload, UPLOAD_REFUSED } from "./graph/style.js";
import { chainFor, uploadToBrain } from "./graph/upload.js";
import { revealLabel } from "./hud/Chat.js";
import { DepartmentCard, summarise } from "./hud/DepartmentCard.js";
import { NoteSheet } from "./hud/NoteSheet.js";
import { Rail, type RailTab } from "./hud/Rail.js";
import { Roster } from "./hud/Roster.js";
import type { SaveState } from "./hud/Settings.js";
import type { DoctorState, ModelsState } from "./hud/SettingsSections.js";
import { StoppedBanner } from "./hud/StoppedBanner.js";
import { TaskBar } from "./hud/TaskBar.js";
import { TopBar } from "./hud/TopBar.js";
import {
  Announcer,
  ListView,
  rememberedView,
  rememberView,
  type View,
  viewFor,
} from "./list/ListView.js";

/**
 * The scene is loaded on demand, not with the page.
 *
 * three.js, fiber and drei are about 1.4 MB of the bundle, and a visitor on a
 * phone or in the list view never renders a single frame of it. Splitting here
 * means they never download it either.
 */
const Scene = lazy(async () => ({ default: (await import("./scene/Scene.js")).Scene }));

/**
 * The graph is loaded when somebody asks for it.
 *
 * A force layout and the drawing around it are a few kilobytes that only matter
 * once G is pressed, and the first load is a budget every visitor pays whether
 * they open the brain or not.
 */
const GraphOverlay = lazy(async () => ({
  default: (await import("./hud/GraphOverlay.js")).GraphOverlay,
}));

/**
 * Settings is loaded when it is opened.
 *
 * It is a modal nobody sees on a first visit — the provider rows, the routine
 * list and their wording are several kilobytes of a budget every visitor pays
 * whether or not they ever open it.
 */
const Settings = lazy(async () => ({ default: (await import("./hud/Settings.js")).Settings }));

import { useOfficeStore } from "./store.js";
import { OfficeSocket, readToken } from "./ws.js";

let nextReqId = 0;
const reqId = (): string => `r${++nextReqId}`;

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(query.matches);
    const listener = (e: MediaQueryListEvent): void => setDark(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return dark;
}

export function App(): ReactElement {
  const store = useOfficeStore();
  const dark = usePrefersDark();
  const [tab, setTab] = useState<RailTab>("activity");
  const [openNote, setOpenNote] = useState<string | undefined>(undefined);
  const [graphOpen, setGraphOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [graph, setGraph] = useState<BrainGraph | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [samplesBusy, setSamplesBusy] = useState(false);
  // SR-067: all three are asked for on a click, so none of them is fetched for
  // somebody who never opens Settings.
  const [doctor, setDoctor] = useState<DoctorState>({ kind: "idle" });
  const [models, setModels] = useState<ModelsState>({ kind: "idle" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);

  /** Re-enables anything that disabled itself while waiting on the office. */
  const clearBusy = useCallback((): void => {
    setRevoking(null);
    setSavingModel(false);
    setSamplesBusy(false);
  }, []);
  const [view, setView] = useState<View>(() =>
    viewFor(typeof window === "undefined" ? 1440 : window.innerWidth, rememberedView()),
  );
  const [announcement, setAnnouncement] = useState("");
  const announcer = useRef(new Announcer());
  const [keyStates, setKeyStates] = useState<Record<string, SaveState>>({});
  /** reqId -> provider, so an ack or error lands on the row that asked. */
  const keyReqs = useRef(new Map<string, string>());
  /** reqIds waiting on an authorisation URL to open. */
  const oauthReqs = useRef(new Set<string>());
  const token = useMemo(() => readToken(), []);

  const socket = useMemo(() => {
    const token = readToken();
    if (token === undefined) return undefined;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

    return new OfficeSocket({
      url,
      token,
      onConnection: (connection) => useOfficeStore.getState().setConnection(connection),
      onMessage: (message) => {
        const state = useOfficeStore.getState();
        switch (message.type) {
          case "welcome":
            state.applyWelcome(
              message.state,
              message.mode,
              message.version,
              message.platform,
              message.editors,
            );
            // Asked for once, here, rather than when a view opens: both the
            // picture and the table want it, and it is one snapshot either way.
            socket?.send({ type: "brain.graph.get", reqId: reqId() });
            break;
          case "state":
            state.applyState(message.state);
            break;
          case "event":
            state.applyEvent(message.event);
            break;
          case "tools.reloaded":
            state.addToolNotice({
              file: message.file,
              ok: message.ok,
              ...(message.message === undefined ? {} : { message: message.message }),
              ...(message.line === undefined ? {} : { line: message.line }),
              ...(message.tools === undefined ? {} : { tools: message.tools }),
              ...(message.name === undefined ? {} : { name: message.name }),
              ...(message.warning === undefined ? {} : { warning: message.warning }),
              ...(message.unassigned === undefined ? {} : { unassigned: message.unassigned }),
              ...(message.agents === undefined ? {} : { agents: message.agents }),
            });
            break;
          case "brain.graph":
            setGraph(message.graph);
            break;
          case "doctor.result":
            setDoctor({ kind: "done", checks: message.checks, ok: message.ok });
            break;
          case "models.result":
            setModels({ kind: "done", providers: message.providers });
            break;
          // Patched rather than refetched: a force layout that reruns is a
          // picture that jumps under the cursor of whoever is reading it.
          case "brain.note.indexed":
            setGraph((current) =>
              current === undefined ? current : applyIndexed(current, message.node, message.edges),
            );
            break;
          case "brain.note.removed":
            setGraph((current) =>
              current === undefined
                ? current
                : applyRemoved(current, message.noteId, message.nowMissing, message.edges),
            );
            break;
          case "brain.warning":
            state.addToolNotice({
              file: message.noteId ?? "brain",
              ok: false,
              message: message.message,
            });
            break;
          case "ack": {
            // Every button that disables itself while the office thinks re-opens
            // here. A card left disabled after a failure is worse than one that
            // never disabled at all: nothing on screen says why.
            clearBusy();
            const provider = keyReqs.current.get(message.reqId);
            if (provider !== undefined) {
              keyReqs.current.delete(message.reqId);
              setKeyStates((prev) => ({ ...prev, [provider]: { kind: "saved" } }));
            }
            if (oauthReqs.current.delete(message.reqId)) {
              // Opened here rather than by the office: the sign-in stays on the
              // owner's own click, and `noopener` keeps the provider's page from
              // reaching back into this one.
              const url = (message.result as { url?: string } | undefined)?.url;
              if (typeof url === "string") window.open(url, "_blank", "noopener,noreferrer");
            }
            break;
          }
          case "error": {
            clearBusy();
            // A failed key belongs under its own row, not in the rail's error slot.
            const failedReqId = message.reqId;
            if (failedReqId !== undefined) oauthReqs.current.delete(failedReqId);
            const provider =
              failedReqId === undefined ? undefined : keyReqs.current.get(failedReqId);
            if (provider !== undefined && failedReqId !== undefined) {
              keyReqs.current.delete(failedReqId);
              setKeyStates((prev) => ({
                ...prev,
                [provider]: { kind: "failed", message: message.message, hint: message.hint },
              }));
              break;
            }
            state.applyError({ code: message.code, message: message.message, hint: message.hint });
            break;
          }
          default:
            break;
        }
      },
    });
    // clearBusy never changes identity, so the socket is still opened once.
  }, [clearBusy]);

  useEffect(() => {
    socket?.connect();
    return () => socket?.close();
  }, [socket]);

  /*
   * G opens the brain, and asks for it the first time.
   *
   * Ignored while somebody is typing: a shortcut that swallows a letter out of
   * the task bar is a shortcut people learn to fear.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "g" && event.key !== "G") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target?.isContentEditable === true) return;

      event.preventDefault();
      setGraphOpen((open) => {
        if (!open) socket?.send({ type: "brain.graph.get", reqId: reqId() });
        return !open;
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [socket]);

  // One line per agent per five seconds. A busy office that narrates every event
  // talks over itself and becomes unusable with a screen reader.
  const busy = useMemo(
    () =>
      (store.state?.agents ?? [])
        .filter((agent) => agent.status !== "idle")
        .map((agent) => ({ id: agent.id, status: agent.status, name: agent.name ?? agent.id })),
    [store.state?.agents],
  );

  useEffect(() => {
    const now = Date.now();
    for (const agent of busy) {
      const doing =
        agent.status === "working"
          ? "working"
          : agent.status === "waiting_approval"
            ? "waiting for you"
            : "stuck";
      const said = announcer.current.consider(agent.id, `${agent.name} is ${doing}.`, now);
      if (said !== undefined) setAnnouncement(said);
    }
  }, [busy]);

  /*
   * The three things that can be done to a routine.
   *
   * Written once and handed to both the rail and the list view: they are the
   * same routines and the same actions, and two copies would be two places for
   * a wording change to be half-applied.
   */
  const routineActions = useMemo(
    () => ({
      onPause: (id: string, paused: boolean) =>
        socket?.send({ type: "routine.upsert", reqId: reqId(), routine: { id, paused } }),
      onRunNow: (id: string) =>
        socket?.send({ type: "routine.run_now", reqId: reqId(), routineId: id }),
      onDelete: (id: string) =>
        socket?.send({ type: "routine.delete", reqId: reqId(), routineId: id }),
    }),
    [socket],
  );

  const departments = useMemo(
    () => (store.state === undefined ? [] : summarise(store.state, dark)),
    [store.state, dark],
  );

  // An approval is the loudest thing on screen, so the rail opens itself for one.
  useEffect(() => {
    if ((store.state?.approvals.length ?? 0) > 0) setTab("activity");
  }, [store.state?.approvals.length]);

  // The view follows the window: narrow is forced to the list, wide defaults to
  // the office, and only the band between them remembers a choice.
  useEffect(() => {
    const onResize = (): void => setView(viewFor(window.innerWidth, rememberedView()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // L toggles, but never out of the list on a screen too narrow for the office.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "l" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement?.tagName;
      if (active === "INPUT" || active === "TEXTAREA" || active === "SELECT") return;
      event.preventDefault();
      setView((current) => {
        const next: View = current === "list" ? "scene" : "list";
        const allowed = viewFor(window.innerWidth, next);
        rememberView(allowed);
        return allowed;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Alt+C/A/P move between the rail's sections without reaching for the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      const wanted: RailTab | undefined =
        key === "c" ? "chat" : key === "a" ? "activity" : key === "p" ? "results" : undefined;
      if (wanted === undefined) return;
      event.preventDefault();
      setTab(wanted);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (store.state === undefined) {
    return (
      <main className="loading">
        <p>
          {store.connection === "stopped" ? "The office is not answering." : "Opening the office"}
        </p>
      </main>
    );
  }

  const state = store.state;
  const selectedAgent = state.agents.find((a) => a.id === store.selectedAgentId);
  const turns =
    selectedAgent === undefined
      ? []
      : Object.entries(store.chats)
          .filter(([runId]) => store.runAgents[runId] === selectedAgent.id)
          .flatMap(([, list]) => list)
          .sort((a, b) => a.at - b.at);
  const lastDeliverable =
    selectedAgent === undefined
      ? undefined
      : state.latestDeliverables.find((d) => d.agentId === selectedAgent.id);

  return (
    <>
      {/* First in tab order: a keyboard user should never have to pass the whole
          interface to reach the readable version of it. */}
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          setView("list");
          // The list may not be mounted yet, so focus it once React has drawn it.
          requestAnimationFrame(() => document.getElementById("list-view")?.focus());
        }}
      >
        Skip to list view
      </button>

      {/* The canvas is decorative to a screen reader: the list says the same
          things in a form it can actually read. */}
      {view === "scene" && (
        <div aria-hidden="true">
          {/* No fallback: the panels are already drawn over the office, so an
              empty ground for a moment is less jarring than a spinner. */}
          <Suspense fallback={null}>
            <Scene state={state} />
          </Suspense>
        </div>
      )}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <div className="hud">
        <StoppedBanner connection={store.connection} platform={store.platform} />
        <TopBar
          state={state}
          mode={store.mode}
          connection={store.connection}
          onSettings={() => setSettingsOpen(true)}
          onSignIn={(server) => {
            const id = reqId();
            oauthReqs.current.add(id);
            socket?.send({ type: "mcp.oauth.begin", reqId: id, server });
          }}
          onReconnect={(server) => socket?.send({ type: "mcp.reconnect", reqId: reqId(), server })}
        />

        <div className="hud-body">
          <div className="left">
            <section className="panel" aria-label="Departments">
              <div className="panel-head">
                <h2 className="panel-title">Departments</h2>
                <span className="panel-note">{departments.length}</span>
              </div>
              <div className="cards">
                {departments.map((summary) => (
                  <DepartmentCard
                    key={summary.id}
                    summary={summary}
                    dark={dark}
                    selected={store.focusedPod === summary.pod}
                    onSelect={() =>
                      useOfficeStore
                        .getState()
                        .focusPod(store.focusedPod === summary.pod ? null : summary.pod)
                    }
                  />
                ))}
              </div>
            </section>

            <Roster
              state={state}
              dark={dark}
              selectedId={store.selectedAgentId}
              onSelect={(agentId) => {
                const store_ = useOfficeStore.getState();
                store_.selectAgent(store_.selectedAgentId === agentId ? null : agentId);
                if (store_.selectedAgentId !== agentId) setTab("chat");
              }}
            />
          </div>

          {/*
           * Drop a file anywhere on the office to put it in the brain.
           *
           * The spec asks for a drop zone on the Brain cylinder itself. Hit
           * testing a mesh through DOM drag events means raycasting on every
           * dragover, which is a lot of machinery to make the target smaller:
           * the whole stage is easier to hit and says where the file is going.
           */}
          {/* A section rather than a div, because it is a labelled region a
              file can be dropped into and somebody has to be able to be told
              that. */}
          <section
            className="stage"
            aria-label="The office. Drop a file here to add it to the brain."
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDropping(false);
              const file = event.dataTransfer.files[0];
              if (file === undefined) return;
              if (!acceptsUpload(file.name)) {
                useOfficeStore.getState().addToolNotice({
                  kind: "brain",
                  file: file.name,
                  ok: false,
                  message: UPLOAD_REFUSED,
                });
                return;
              }
              void uploadToBrain(file, token).then((failure) => {
                if (failure !== undefined) {
                  useOfficeStore
                    .getState()
                    .addToolNotice({ kind: "brain", file: file.name, ok: false, message: failure });
                }
              });
            }}
          >
            {dropping && <p className="stage-drop">Drop it here to add it to the brain</p>}
            {view === "list" && (
              <ListView
                state={state}
                graph={graph}
                onOpenAgent={(agentId) => {
                  useOfficeStore.getState().selectAgent(agentId);
                  setTab("chat");
                }}
                onOpenNote={(noteId) => setOpenNote(noteId)}
                onUpload={(file) => {
                  void uploadToBrain(file, token).then((failure) => {
                    if (failure !== undefined) {
                      useOfficeStore.getState().addToolNotice({
                        kind: "brain",
                        file: file.name,
                        ok: false,
                        message: failure,
                      });
                    }
                  });
                }}
                onRefuse={(message) =>
                  useOfficeStore
                    .getState()
                    .addToolNotice({ kind: "brain", file: "", ok: false, message })
                }
                routineActions={routineActions}
              />
            )}
            <TaskBar
              state={state}
              disabled={store.connection !== "open"}
              onSubmit={(department, text, schedule) => {
                const id = reqId();
                // A scheduled task is not a task in flight, so it is not tracked
                // as one: nothing is going to happen now for the office to show.
                if (schedule === undefined) useOfficeStore.getState().trackTask(id);
                socket?.send({
                  type: "task.create",
                  reqId: id,
                  department,
                  text,
                  ...(schedule === undefined ? {} : { schedule }),
                });
              }}
            />
          </section>

          <Rail
            state={state}
            activity={store.activity}
            tab={tab}
            onTab={setTab}
            error={store.lastError}
            onDecide={(approval, decision, note, match) =>
              socket?.send({
                type: "approval.decide",
                reqId: reqId(),
                approvalId: approval.id,
                decision,
                ...(note === undefined || note.length === 0 ? {} : { note }),
                ...(match === undefined ? {} : { match }),
              })
            }
            onOpenNote={(noteId) => setOpenNote(noteId)}
            onReveal={(noteId) => socket?.send({ type: "note.reveal", reqId: reqId(), noteId })}
            agent={selectedAgent}
            turns={turns}
            deliverable={lastDeliverable}
            platform={store.platform}
            onRename={(agentId, name) =>
              socket?.send({ type: "agent.rename", reqId: reqId(), agentId, name })
            }
            onSend={(agentId, text) =>
              socket?.send({ type: "chat.send", reqId: reqId(), agentId, text })
            }
            notices={store.toolNotices}
            onDismissNotice={(id) => useOfficeStore.getState().dismissToolNotice(id)}
            onAssign={(name, agentIds) =>
              // One message for the whole card: the owner ticked a set of people
              // and pressed Save once, so three of four succeeding is one answer
              // to report, not three acks to reconcile.
              socket?.send({ type: "tools.assign", reqId: reqId(), name, agentIds })
            }
          />
        </div>
      </div>

      {settingsOpen && (
        <Suspense fallback={null}>
          <Settings
            mode={store.mode}
            states={keyStates}
            routines={state.routines}
            routineActions={routineActions}
            defaultModel={state.defaultModel}
            whitelist={state.whitelist}
            revoking={revoking}
            onRevoke={(key) => {
              // Cleared by the next snapshot rather than here: the row leaves
              // the list when the office says it has, which is also what
              // happens when somebody deletes it from the file by hand.
              setRevoking(key);
              socket?.send({ type: "approvals.revoke", reqId: reqId(), key });
            }}
            doctor={doctor}
            onRunDoctor={() => {
              setDoctor({ kind: "running" });
              socket?.send({ type: "doctor.run", reqId: reqId() });
            }}
            models={models}
            savingModel={savingModel}
            onLoadModels={() => {
              setModels({ kind: "loading" });
              socket?.send({ type: "models.list", reqId: reqId() });
            }}
            onChooseModel={(model) => {
              setSavingModel(true);
              socket?.send({ type: "agents.set_default_model", reqId: reqId(), model });
            }}
            sampleQuestion={state.sampleQuestion}
            sampleBusy={samplesBusy}
            onAnswerSamples={(remove) => {
              // Left busy until the server answers: the card disappears when
              // the next snapshot arrives with no question in it, which is the
              // office confirming rather than the browser assuming.
              setSamplesBusy(true);
              socket?.send({ type: "demo.samples", reqId: reqId(), remove });
            }}
            onClose={() => setSettingsOpen(false)}
            onSave={(provider, value) => {
              const id = reqId();
              keyReqs.current.set(id, provider);
              setKeyStates((prev) => ({ ...prev, [provider]: { kind: "saving" } }));
              socket?.send({ type: "provider.set_key", reqId: id, provider, key: value });
            }}
          />
        </Suspense>
      )}
      {graphOpen && (
        <Suspense fallback={null}>
          <GraphOverlay
            graph={graph}
            onClose={() => setGraphOpen(false)}
            onOpenNote={(noteId) => setOpenNote(noteId)}
            onUpload={(file) => {
              void uploadToBrain(file, token).then((failure) => {
                if (failure !== undefined) {
                  useOfficeStore
                    .getState()
                    .addToolNotice({ kind: "brain", file: file.name, ok: false, message: failure });
                }
              });
            }}
            onRefuse={(message) =>
              useOfficeStore
                .getState()
                .addToolNotice({ kind: "brain", file: "", ok: false, message })
            }
          />
        </Suspense>
      )}

      {openNote !== undefined && (
        <NoteSheet
          noteId={openNote}
          token={token}
          revealLabel={revealLabel(store.platform)}
          editor={store.editors[0]}
          revisions={chainFor(graph, openNote)}
          onReveal={() => socket?.send({ type: "note.reveal", reqId: reqId(), noteId: openNote })}
          onOpenInEditor={(app) =>
            socket?.send({ type: "note.reveal", reqId: reqId(), noteId: openNote, app })
          }
          onClose={() => setOpenNote(undefined)}
        />
      )}
    </>
  );
}
