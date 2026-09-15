/**
 * The office, top to bottom.
 *
 * Three layers: the model, the cards that read it, and the rail that says what
 * actually happened. Everything reads from the store, which holds the office's own
 * account of itself; nothing here decides anything on its own.
 */
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { DepartmentCard, summarise } from "./hud/DepartmentCard.js";
import { Rail, type RailTab } from "./hud/Rail.js";
import { Roster } from "./hud/Roster.js";
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
            state.applyWelcome(message.state, message.mode, message.version);
            break;
          case "state":
            state.applyState(message.state);
            break;
          case "event":
            state.applyEvent(message.event);
            break;
          case "error":
            state.applyError({ code: message.code, message: message.message, hint: message.hint });
            break;
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

  return (
    <>
      <Scene state={state} />

      <div className="hud">
        <TopBar state={state} mode={store.mode} connection={store.connection} />

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

            <Roster state={state} dark={dark} />
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
            onOpenNote={(noteId) => socket?.send({ type: "note.reveal", reqId: reqId(), noteId })}
          />
        </div>
      </div>
    </>
  );
}
