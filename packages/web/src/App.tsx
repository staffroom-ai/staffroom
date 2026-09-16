/**
 * The office, top to bottom.
 *
 * Three layers: the model, the cards that read it, and the rail that says what
 * actually happened. Everything reads from the store, which holds the office's own
 * account of itself; nothing here decides anything on its own.
 */
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { revealLabel } from "./hud/Chat.js";
import { DepartmentCard, summarise } from "./hud/DepartmentCard.js";
import { NoteSheet } from "./hud/NoteSheet.js";
import { Rail, type RailTab } from "./hud/Rail.js";
import { Roster } from "./hud/Roster.js";
import { type SaveState, Settings } from "./hud/Settings.js";
import { StoppedBanner } from "./hud/StoppedBanner.js";
import { TaskBar } from "./hud/TaskBar.js";
import { TopBar } from "./hud/TopBar.js";
import { Scene } from "./scene/Scene.js";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyStates, setKeyStates] = useState<Record<string, SaveState>>({});
  /** reqId -> provider, so an ack or error lands on the row that asked. */
  const keyReqs = useRef(new Map<string, string>());
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
            state.applyWelcome(message.state, message.mode, message.version, message.platform);
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
              ...(message.tools === undefined ? {} : { tools: message.tools }),
            });
            break;
          case "ack": {
            const provider = keyReqs.current.get(message.reqId);
            if (provider !== undefined) {
              keyReqs.current.delete(message.reqId);
              setKeyStates((prev) => ({ ...prev, [provider]: { kind: "saved" } }));
            }
            break;
          }
          case "error": {
            // A failed key belongs under its own row, not in the rail's error slot.
            const failedReqId = message.reqId;
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
  }, []);

  useEffect(() => {
    socket?.connect();
    return () => socket?.close();
  }, [socket]);

  const departments = useMemo(
    () => (store.state === undefined ? [] : summarise(store.state, dark)),
    [store.state, dark],
  );

  // An approval is the loudest thing on screen, so the rail opens itself for one.
  useEffect(() => {
    if ((store.state?.approvals.length ?? 0) > 0) setTab("activity");
  }, [store.state?.approvals.length]);

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
      <Scene state={state} />

      <div className="hud">
        <StoppedBanner connection={store.connection} platform={store.platform} />
        <TopBar
          state={state}
          mode={store.mode}
          connection={store.connection}
          onSettings={() => setSettingsOpen(true)}
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

          <div className="stage">
            <TaskBar
              state={state}
              disabled={store.connection !== "open"}
              onSubmit={(department, text) => {
                const id = reqId();
                useOfficeStore.getState().trackTask(id);
                socket?.send({ type: "task.create", reqId: id, department, text });
              }}
            />
          </div>

          <Rail
            state={state}
            activity={store.activity}
            tab={tab}
            onTab={setTab}
            error={store.lastError}
            onDecide={(approval, decision, note) =>
              socket?.send({
                type: "approval.decide",
                reqId: reqId(),
                approvalId: approval.id,
                decision,
                ...(note === undefined || note.length === 0 ? {} : { note }),
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
            onAssign={(tool, agentIds) => {
              // One message per agent: the server's tools.assign takes a single
              // pair, and a card with three people ticked is three assignments.
              for (const agentId of agentIds) {
                socket?.send({ type: "tools.assign", reqId: reqId(), agentId, tool });
              }
            }}
          />
        </div>
      </div>

      {settingsOpen && (
        <Settings
          mode={store.mode}
          states={keyStates}
          onClose={() => setSettingsOpen(false)}
          onSave={(provider, value) => {
            const id = reqId();
            keyReqs.current.set(id, provider);
            setKeyStates((prev) => ({ ...prev, [provider]: { kind: "saving" } }));
            socket?.send({ type: "provider.set_key", reqId: id, provider, key: value });
          }}
        />
      )}

      {openNote !== undefined && (
        <NoteSheet
          noteId={openNote}
          token={token}
          revealLabel={revealLabel(store.platform)}
          onReveal={() => socket?.send({ type: "note.reveal", reqId: reqId(), noteId: openNote })}
          onClose={() => setOpenNote(undefined)}
        />
      )}
    </>
  );
}
