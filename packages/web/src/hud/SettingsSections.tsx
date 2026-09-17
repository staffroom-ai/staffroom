/**
 * The three sections of Settings that are about the office rather than a key.
 *
 * Kept out of Settings.tsx because each answers a different question and only
 * shares a panel with the others: what have I already allowed, is anything
 * wrong, and which model does everybody use.
 */
import type { WhitelistRow } from "@staffroom/core";
import type { ReactElement } from "react";
import type { DoctorCheck } from "../protocol.js";

/**
 * How long ago, in the words somebody would use.
 *
 * Days rather than a date, because the question this list answers is "is this
 * permission still earning its place?" and nobody answers that by working out
 * how long ago the 8th of August was.
 */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return "never used";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "never used";

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "used just now";
  if (minutes < 60) return `used ${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `used ${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `used ${days} day${days === 1 ? "" : "s"} ago`;
}

/** What the permission is pinned to, as a phrase rather than a data structure. */
export function pinnedTo(match: Record<string, string>): string {
  const fields = Object.entries(match);
  // No match at all is the widest permission there is, and the list has to say
  // so plainly rather than leaving the line blank.
  if (fields.length === 0) return "any input";
  return fields.map(([field, pattern]) => `${field} matching ${pattern}`).join(", ");
}

export function Whitelist({
  rows,
  busy,
  onRevoke,
}: {
  rows: WhitelistRow[];
  busy: string | null;
  onRevoke: (key: string) => void;
}): ReactElement {
  if (rows.length === 0) {
    return (
      <p className="routines-empty">
        Nobody has been given standing permission for anything. Every write still asks.
      </p>
    );
  }

  return (
    <ul className="allow-list">
      {rows.map((row) => (
        <li key={row.key} className={row.suspended ? "allow-row is-suspended" : "allow-row"}>
          <div className="allow-what">
            <span className="allow-tool">{row.tool}</span>
            <span className="allow-who">for {row.agentName ?? row.agentId}</span>
          </div>
          <p className="setting-note">
            {pinnedTo(row.match)} · {ago(row.lastUsed)}
          </p>
          {row.suspended && (
            <p className="setting-note">
              This tool changed since you allowed it, so the next call asks again.
            </p>
          )}
          <button
            type="button"
            className="btn-quiet"
            disabled={busy === row.key}
            onClick={() => onRevoke(row.key)}
          >
            {busy === row.key ? "Revoking…" : "Revoke"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export type DoctorState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; checks: DoctorCheck[]; ok: boolean };

const STATUS_WORD: Record<DoctorCheck["status"], string> = {
  ok: "OK",
  warn: "Check",
  fail: "Problem",
};

export function Doctor({ state, onRun }: { state: DoctorState; onRun: () => void }): ReactElement {
  return (
    <div className="doctor">
      <button type="button" className="btn" disabled={state.kind === "running"} onClick={onRun}>
        {state.kind === "running" ? "Checking…" : "Run checks"}
      </button>

      {state.kind === "idle" && (
        <p className="setting-note">
          The same checks as npx staffroom doctor: Node, your office folder, config, providers,
          models, tools and disk.
        </p>
      )}

      {state.kind === "done" && (
        <>
          <p className="setting-note">
            {state.ok
              ? "Everything checked out."
              : "Some checks need you. Each one says what to do."}
          </p>
          {/* A table rather than a list: every row has the same three parts,
              and the statuses only read as a column when they line up. */}
          <table className="doctor-table">
            <tbody>
              {state.checks.map((check) => (
                <tr key={check.id} className={`doctor-${check.status}`}>
                  <td className="doctor-status">{STATUS_WORD[check.status]}</td>
                  <td className="doctor-id">{check.id}</td>
                  <td>
                    {check.message}
                    {check.hint !== undefined && <span className="setting-hint">{check.hint}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export interface ProviderModels {
  id: string;
  models: { id: string; created?: string }[];
  error?: string;
}

export type ModelsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; providers: ProviderModels[] };

/**
 * Every model on offer, as `provider/model`, which is what agents.yaml holds.
 *
 * Flattened across providers because the owner is picking a model, not a
 * provider, and a select grouped by something they did not ask about is a
 * select they have to read twice.
 */
export function modelChoices(providers: ProviderModels[]): string[] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => `${provider.id}/${model.id}`),
  );
}

export function DefaultModel({
  current,
  state,
  saving,
  onLoad,
  onChoose,
}: {
  current: string | null;
  state: ModelsState;
  saving: boolean;
  onLoad: () => void;
  onChoose: (model: string) => void;
}): ReactElement {
  const choices = state.kind === "done" ? modelChoices(state.providers) : [];
  // The model in the file belongs in the list even when the provider that
  // offers it did not answer. A select that silently dropped the current value
  // would look like somebody had changed it.
  const options = current !== null && !choices.includes(current) ? [current, ...choices] : choices;
  const failures =
    state.kind === "done" ? state.providers.filter((p) => p.error !== undefined) : [];

  return (
    <div className="setting-field">
      {state.kind === "done" ? (
        <select
          className="setting-input"
          aria-label="Default model"
          value={current ?? ""}
          disabled={saving}
          onChange={(event) => onChoose(event.target.value)}
        >
          {current === null && <option value="">Pick a model</option>}
          {options.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          className="btn-quiet"
          disabled={state.kind === "loading"}
          onClick={onLoad}
        >
          {state.kind === "loading" ? "Asking…" : `Show models (${current ?? "none set"})`}
        </button>
      )}

      {failures.map((provider) => (
        // Named, not hidden: this is the screen where the owner would fix it,
        // and "no models" is a much worse answer than "your key was refused".
        <p key={provider.id} className="setting-bad" role="alert">
          {provider.id} could not list its models.
          <span className="setting-hint">{provider.error}</span>
        </p>
      ))}
    </div>
  );
}
