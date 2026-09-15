/**
 * The bar across the top: who this office is, what it is running on, and whether
 * anything is wrong.
 */

import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import type { Connection } from "../ws.js";

const CONNECTION_TEXT: Record<Connection, string | undefined> = {
  connecting: undefined,
  open: undefined,
  reconnecting: "Reconnecting to the office...",
  stopped: "The office is not answering. Check the terminal where you started it.",
};

export function TopBar({
  state,
  mode,
  connection,
}: {
  state: OfficeState;
  mode: "live" | "demo";
  connection: Connection;
}): ReactElement {
  const warning = CONNECTION_TEXT[connection];
  const healthy = state.connectors.filter((c) => c.health === "ok").length;

  return (
    <header className="topbar">
      <div className="topbar-name">{state.officeName}</div>

      {mode === "demo" && (
        <span className="chip chip-demo" title="No model is configured, so this is recorded work.">
          Demo
        </span>
      )}

      <span className="chip" title="The model agents run on unless one of them says otherwise.">
        {state.defaultModel ?? "no model set"}
      </span>

      {healthy > 0 && (
        <span className="chip">
          {healthy} connector{healthy === 1 ? "" : "s"}
        </span>
      )}

      <div className="topbar-spacer" />

      {warning !== undefined && <span className="chip chip-warn">{warning}</span>}

      <time className="topbar-clock" dateTime={state.clock}>
        {new Date(state.clock).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
    </header>
  );
}
