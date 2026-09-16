/**
 * The bar across the top: whose office this is and how it is doing.
 *
 * It used to hold a name and a clock and nothing else, in fifty-two pixels of
 * otherwise empty rule. It now carries the office's vital signs — staff, working,
 * waiting on you — as three numbers in one line, because those are the facts a
 * glance is looking for and the header is where a glance lands first.
 *
 * Everything but the name and the numbers is set as quiet metadata rather than as
 * badges. A border around every fact is what makes an interface look like a
 * template.
 */
import type { OfficeState } from "@staffroom/core";
import type { ReactElement } from "react";
import type { Connection } from "../ws.js";

const CONNECTION_TEXT: Partial<Record<Connection, string>> = {
  reconnecting: "Reconnecting",
  stopped: "Office not answering",
};

function Vital({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "busy" | "waiting" | undefined;
}): ReactElement {
  return (
    <span className={`vital${tone === undefined ? "" : ` vital-${tone}`}`}>
      <span className="vital-value">{value}</span>
      <span className="vital-label">{label}</span>
    </span>
  );
}

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
      <span className="topbar-rule" aria-hidden="true" />

      <div className="vitals">
        <Vital value={state.agents.length} label="on staff" />
        <Vital value={working} label="working" tone={working > 0 ? "busy" : undefined} />
        <Vital value={waiting} label="waiting on you" tone={waiting > 0 ? "waiting" : undefined} />
        <Vital value={state.latestDeliverables.length} label="filed" />
      </div>

      <div className="topbar-spacer" />

      <div className="meta">
        {warning !== undefined && (
          <span className="meta-item meta-warn" role="status">
            <span className="dot" />
            {warning}
          </span>
        )}
        <span className={`meta-item ${mode === "demo" ? "meta-demo" : "meta-live"}`}>
          <span className="dot" />
          {mode === "demo" ? "Demo" : "Live"}
        </span>
        <span className="meta-item">{state.defaultModel ?? "No model"}</span>
      </div>

      <time className="topbar-clock" dateTime={state.clock}>
        {new Date(state.clock).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
    </header>
  );
}
