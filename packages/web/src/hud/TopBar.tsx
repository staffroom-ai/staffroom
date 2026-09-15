/**
 * The bar across the top: whose office this is, what it is running on, and
 * whether anything needs attention.
 *
 * Everything but the office name is set as quiet metadata rather than as badges.
 * A border around every fact is what makes an interface look like a template.
 */
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import type { Connection } from "../ws.js";

const CONNECTION_TEXT: Partial<Record<Connection, string>> = {
  reconnecting: "Reconnecting",
  stopped: "Office not answering",
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
  const waiting = state.approvals.length;
  const working = state.agents.filter((a) => a.status === "working").length;

  return (
    <header className="topbar">
      <span className="topbar-name">{state.officeName}</span>

      <div className="meta">
        <span className={`meta-item ${mode === "demo" ? "meta-demo" : "meta-live"}`}>
          <span className="dot" />
          {mode === "demo" ? "Demo" : "Live"}
        </span>

        <span className="meta-item">{state.defaultModel ?? "No model"}</span>

        {working > 0 && <span className="meta-item">{working} working</span>}

        {waiting > 0 && (
          <span className="meta-item meta-warn">
            <span className="dot" />
            {waiting} waiting on you
          </span>
        )}
      </div>

      <div className="topbar-spacer" />

      {warning !== undefined && (
        <span className="meta-item meta-warn" role="status">
          <span className="dot" />
          {warning}
        </span>
      )}

      <time className="topbar-clock" dateTime={state.clock}>
        {new Date(state.clock).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
    </header>
  );
}
