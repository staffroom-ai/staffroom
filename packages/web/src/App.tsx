/**
 * The office, top to bottom.
 *
 * Holds the socket and nothing else: everything on screen reads from the store,
 * which holds the office's own account of itself.
 */
import { type ReactElement, useEffect, useMemo } from "react";
import { TaskBar } from "./hud/TaskBar.js";
import { TopBar } from "./hud/TopBar.js";
import { Scene } from "./scene/Scene.js";
import { useOfficeStore } from "./store.js";
import { OfficeSocket, readToken } from "./ws.js";

let nextReqId = 0;
const reqId = (): string => `r${++nextReqId}`;

export function App(): ReactElement {
  const store = useOfficeStore();

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

  if (store.state === undefined) {
    return (
      <main className="loading">
        <p>Opening the office...</p>
      </main>
    );
  }

  return (
    <>
      <Scene state={store.state} />
      <div className="hud">
        <TopBar state={store.state} mode={store.mode} connection={store.connection} />
        <TaskBar
          state={store.state}
          disabled={store.connection !== "open"}
          onSubmit={(department, text) => {
            const id = reqId();
            useOfficeStore.getState().trackTask(id);
            socket?.send({ type: "task.create", reqId: id, department, text });
          }}
        />
      </div>
    </>
  );
}
