/**
 * The three sections of Settings that are about the office rather than a key.
 *
 * Kept out of Settings.tsx because each answers a different question and only
 * shares a panel with the others: what have I already allowed, is anything
 * wrong, and which model does everybody use.
 */
import type { WhitelistRow } from "@staffroom/core";
import { type ReactElement, useState } from "react";
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

/* ------------------------------------------------------------------------- *
 * Staff
 *
 * Who works here, editable. Before this the only way to hire somebody was to
 * open agents.yaml in an editor, and the only way to see it take effect was to
 * restart the office — which the documentation did not mention, because the
 * person who wrote it assumed the watcher already handled it.
 *
 * The file is still the source of truth. Everything here is a document-mode
 * write to agents.yaml, so an office edited from this panel and an office
 * edited in vim end up with the same file, comments and all.
 * ------------------------------------------------------------------------- */

export interface StaffAgent {
  id: string;
  name?: string;
  role: string;
  does: string;
  departmentId: string;
}

export interface StaffDepartment {
  id: string;
  label: string;
}

export interface StaffActions {
  onAddAgent: (agent: {
    id: string;
    department: string;
    role: string;
    does: string;
    name?: string;
  }) => void;
  onUpdateAgent: (agentId: string, fields: { role?: string; does?: string }) => void;
  onRemoveAgent: (agentId: string) => void;
  onAddDepartment: (id: string, label: string) => void;
  onRemoveDepartment: (id: string) => void;
}

/** An id the office will accept, suggested from what they typed as a name. */
export function idFrom(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function AgentRow({
  agent,
  onUpdateAgent,
  onRemoveAgent,
}: {
  agent: StaffAgent;
  onUpdateAgent: StaffActions["onUpdateAgent"];
  onRemoveAgent: StaffActions["onRemoveAgent"];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(agent.role);
  const [does, setDoes] = useState(agent.does);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="staff-row">
      <button type="button" className="staff-summary" onClick={() => setOpen(!open)}>
        <span className="staff-name">{agent.name ?? agent.id}</span>
        <span className="staff-role">{agent.role}</span>
      </button>

      {open && (
        <div className="staff-edit">
          <label className="setting-field">
            <span className="setting-note">Role</span>
            <input
              className="setting-input"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </label>
          <label className="setting-field">
            <span className="setting-note">What they do</span>
            <textarea
              className="setting-input"
              rows={2}
              value={does}
              onChange={(event) => setDoes(event.target.value)}
            />
          </label>

          <div className="staff-actions">
            <button
              type="button"
              className="btn"
              disabled={role.trim() === agent.role && does.trim() === agent.does}
              onClick={() => onUpdateAgent(agent.id, { role: role.trim(), does: does.trim() })}
            >
              Save
            </button>

            {/*
              Asked once before it happens. Letting somebody go is not
              destructive — their filed work stays in the brain, and the office
              says so — but it is not a thing to do on a mis-click either.
            */}
            {confirming ? (
              <span className="staff-confirm">
                <span className="setting-note">
                  Remove {agent.name ?? agent.id}? Their filed work stays in the brain.
                </span>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => onRemoveAgent(agent.id)}
                >
                  Remove
                </button>
                <button type="button" className="btn-quiet" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="btn-quiet" onClick={() => setConfirming(true)}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function AddAgent({
  departments,
  onAddAgent,
}: {
  departments: StaffDepartment[];
  onAddAgent: StaffActions["onAddAgent"];
}): ReactElement {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [does, setDoes] = useState("");
  const [department, setDepartment] = useState(departments[0]?.id ?? "");

  const id = idFrom(name);
  // `does` has a minimum length in the schema, so the button says no before the
  // server has to: a refusal you could have predicted is a refusal worth avoiding.
  const ready =
    id.length > 1 && role.trim().length > 0 && does.trim().length >= 10 && department !== "";

  return (
    <div className="staff-add">
      <h4 className="settings-heading">Hire somebody</h4>

      <label className="setting-field">
        <span className="setting-note">Name{id === "" ? "" : ` — id will be ${id}`}</span>
        <input
          className="setting-input"
          value={name}
          placeholder="Wendy"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="setting-field">
        <span className="setting-note">Role</span>
        <input
          className="setting-input"
          value={role}
          placeholder="Bookkeeper"
          onChange={(event) => setRole(event.target.value)}
        />
      </label>

      <label className="setting-field">
        <span className="setting-note">What they do, in a sentence</span>
        <textarea
          className="setting-input"
          rows={2}
          value={does}
          placeholder="Reconciles the bank feed every morning."
          onChange={(event) => setDoes(event.target.value)}
        />
      </label>

      <label className="setting-field">
        <span className="setting-note">Department</span>
        <select
          className="setting-input"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          {departments.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn"
        disabled={!ready}
        onClick={() => {
          onAddAgent({
            id,
            department,
            role: role.trim(),
            does: does.trim(),
            ...(name.trim() === "" ? {} : { name: name.trim() }),
          });
          setName("");
          setRole("");
          setDoes("");
        }}
      >
        Hire
      </button>
    </div>
  );
}

export function Staff({
  agents,
  departments,
  problem,
  actions,
}: {
  agents: StaffAgent[];
  departments: StaffDepartment[];
  /** The office's own sentence when it refused the last edit. */
  problem?: string | null;
  actions: StaffActions;
}): ReactElement {
  const [newDepartment, setNewDepartment] = useState("");

  return (
    <section className="setting-row" aria-label="Staff">
      <h3 className="settings-heading">Staff</h3>
      <p className="setting-note">
        Everything here is written to office/agents.yaml, which you can also edit by hand.
      </p>

      {problem != null && (
        <p className="setting-bad" role="alert">
          {problem}
        </p>
      )}

      {departments.map((department) => (
        <div key={department.id} className="staff-department">
          <div className="staff-department-head">
            <h4 className="settings-heading">{department.label}</h4>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => actions.onRemoveDepartment(department.id)}
            >
              Close
            </button>
          </div>
          <ul className="staff-list">
            {agents
              .filter((agent) => agent.departmentId === department.id)
              .map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  onUpdateAgent={actions.onUpdateAgent}
                  onRemoveAgent={actions.onRemoveAgent}
                />
              ))}
          </ul>
        </div>
      ))}

      <AddAgent departments={departments} onAddAgent={actions.onAddAgent} />

      <div className="staff-add">
        <h4 className="settings-heading">Open a department</h4>
        {/*
          A department with nobody in it is in the file and not yet on the floor:
          the wedges are drawn from where people sit. Said here rather than left
          for somebody to wonder about when the room does not change.
        */}
        <p className="setting-note">It appears in the room once somebody works there.</p>
        <label className="setting-field">
          <span className="setting-note">Name</span>
          <input
            className="setting-input"
            value={newDepartment}
            placeholder="Support"
            onChange={(event) => setNewDepartment(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={idFrom(newDepartment).length < 2}
          onClick={() => {
            actions.onAddDepartment(idFrom(newDepartment), newDepartment.trim());
            setNewDepartment("");
          }}
        >
          Open
        </button>
      </div>
    </section>
  );
}
