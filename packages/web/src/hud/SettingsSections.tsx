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
  onRenameOffice: (name: string) => void;
  onAddAgent: (agent: {
    id: string;
    department: string;
    role: string;
    does: string;
    name?: string;
    departmentLabel?: string;
  }) => void;
  onUpdateAgent: (
    agentId: string,
    fields: { role?: string; does?: string; department?: string },
  ) => void;
  onRemoveAgent: (agentId: string) => void;
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
  departments,
  onUpdateAgent,
  onRemoveAgent,
}: {
  agent: StaffAgent;
  departments: StaffDepartment[];
  onUpdateAgent: StaffActions["onUpdateAgent"];
  onRemoveAgent: StaffActions["onRemoveAgent"];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(agent.role);
  const [does, setDoes] = useState(agent.does);
  const [department, setDepartment] = useState(agent.departmentId);
  const [confirming, setConfirming] = useState(false);
  const changed =
    role.trim() !== agent.role || does.trim() !== agent.does || department !== agent.departmentId;

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

          {/*
            Moving somebody is also how a department closes: the wedges are drawn
            from where people sit, so the last person to leave one takes it with
            them. There is no separate "close" for that reason.
          */}
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

          <div className="staff-actions">
            <button
              type="button"
              className="btn"
              disabled={!changed}
              onClick={() =>
                onUpdateAgent(agent.id, {
                  role: role.trim(),
                  does: does.trim(),
                  department,
                })
              }
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
  const [newDepartment, setNewDepartment] = useState("");

  const NEW = "\u2014new";
  const opening = department === NEW;
  const id = idFrom(name);
  const departmentId = opening ? idFrom(newDepartment) : department;
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

      {/*
        A new department is opened here rather than on its own.
        `departments:` in agents.yaml is a map of display names, not a list, so a
        department exists because somebody works in it. A separate "open a
        department" button wrote a label that nothing could use and nothing
        showed — including this very list, so you could not then hire into it.
      */}
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
          <option value={NEW}>New department…</option>
        </select>
      </label>

      {opening && (
        <label className="setting-field">
          <span className="setting-note">New department's name</span>
          <input
            className="setting-input"
            value={newDepartment}
            placeholder="Support"
            onChange={(event) => setNewDepartment(event.target.value)}
          />
        </label>
      )}

      <button
        type="button"
        className="btn"
        disabled={!ready}
        onClick={() => {
          onAddAgent({
            id,
            department: departmentId,
            role: role.trim(),
            does: does.trim(),
            ...(name.trim() === "" ? {} : { name: name.trim() }),
            ...(opening ? { departmentLabel: newDepartment.trim() } : {}),
          });
          setName("");
          setRole("");
          setDoes("");
          setNewDepartment("");
          setDepartment(departments[0]?.id ?? "");
        }}
      >
        Hire
      </button>
    </div>
  );
}

/** The name on the top bar, and what the staff call the place in a prompt. */
function OfficeName({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}): ReactElement {
  const [value, setValue] = useState(name);

  return (
    <div className="staff-add">
      <label className="setting-field">
        <span className="setting-note">Office name</span>
        <input
          className="setting-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn"
        disabled={value.trim() === name || value.trim().length === 0}
        onClick={() => onRename(value.trim())}
      >
        Rename
      </button>
    </div>
  );
}

export function Staff({
  agents,
  departments,
  officeName,
  problem,
  actions,
}: {
  agents: StaffAgent[];
  departments: StaffDepartment[];
  officeName: string;
  /** The office's own sentence when it refused the last edit. */
  problem?: string | null;
  actions: StaffActions;
}): ReactElement {
  return (
    <section className="setting-row" aria-label="Staff">
      <h3 className="settings-heading">This office</h3>
      <OfficeName name={officeName} onRename={actions.onRenameOffice} />

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
          <h4 className="settings-heading">{department.label}</h4>
          <ul className="staff-list">
            {agents
              .filter((agent) => agent.departmentId === department.id)
              .map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  departments={departments}
                  onUpdateAgent={actions.onUpdateAgent}
                  onRemoveAgent={actions.onRemoveAgent}
                />
              ))}
          </ul>
        </div>
      ))}

      <AddAgent departments={departments} onAddAgent={actions.onAddAgent} />
    </section>
  );
}

/* ------------------------------------------------------------------------- *
 * Gmail
 *
 * One connector, not a catalogue. Adding a Gmail server to config.yaml by hand
 * is four lines of YAML in a file most people will never open, and the two
 * questions that actually matter — is it connected, and who can use it — had no
 * answer anywhere in the office.
 *
 * Deliberately Gmail-shaped. The writers underneath take any server, so a
 * second connector is a second panel rather than a second protocol.
 * ------------------------------------------------------------------------- */

export interface GmailState {
  /** From the connector strip: absent when it is not in config.yaml at all. */
  health?: "ok" | "starting" | "unavailable" | "denied" | "grey" | "needs_auth" | undefined;
  message?: string | null | undefined;
  toolCount?: number | undefined;
  /** Empty means every department, which is what the office does with no wiring. */
  departments: string[];
  /** Agents whose own tools list names the server. */
  agentIds: string[];
}

export interface GmailActions {
  onAdd: (url: string) => void;
  onRemove: () => void;
  onScope: (departments: string[]) => void;
  onSetAgents: (agentIds: string[]) => void;
  onConnect: () => void;
}

/** What the strip's health means to somebody who has not read the code. */
export function gmailStatusLine(state: GmailState): string {
  if (state.health === undefined) return "Not connected.";
  if (state.health === "denied") return "Denied in config.yaml, so nobody can use it.";
  if (state.health === "starting") return "Connecting…";
  if (state.health === "needs_auth") return "Needs you to sign in.";
  if (state.health === "unavailable") return state.message ?? "Not answering.";
  return `Connected, ${state.toolCount ?? 0} tool(s).`;
}

export function Gmail({
  state,
  agents,
  departments,
  actions,
}: {
  state: GmailState;
  agents: StaffAgent[];
  departments: StaffDepartment[];
  actions: GmailActions;
}): ReactElement {
  const [url, setUrl] = useState("");

  if (state.health === undefined) {
    return (
      <section className="setting-row" aria-label="Gmail">
        <h3 className="settings-heading">Gmail</h3>
        <p className="setting-note">
          The address of your Gmail MCP server. Staffroom does not run one for you — this is a
          server you host or subscribe to, and it is the only thing that ever sees your mail.
        </p>
        <label className="setting-field">
          <span className="setting-note">Server address</span>
          <input
            className="setting-input"
            value={url}
            placeholder="https://mcp.example.com/gmail"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={!/^https?:\/\/\S+$/.test(url.trim())}
          onClick={() => {
            actions.onAdd(url.trim());
            setUrl("");
          }}
        >
          Add Gmail
        </button>
      </section>
    );
  }

  return (
    <section className="setting-row" aria-label="Gmail">
      <div className="staff-department-head">
        <h3 className="settings-heading">Gmail</h3>
        <button type="button" className="btn-quiet" onClick={actions.onRemove}>
          Remove
        </button>
      </div>
      <p className="setting-note">{gmailStatusLine(state)}</p>

      {state.health === "needs_auth" && (
        <button type="button" className="btn" onClick={actions.onConnect}>
          Sign in to Gmail
        </button>
      )}

      {/*
        Two fences, and both are here because they answer different questions.
        A department list is "nobody outside Support, whatever their row says";
        the agent list is "and within Support, only these people".
      */}
      <div className="staff-add">
        <h4 className="settings-heading">Which departments may use it</h4>
        <p className="setting-note">None ticked means every department.</p>
        {departments.map((department) => (
          <label key={department.id} className="setting-check">
            <input
              type="checkbox"
              checked={state.departments.includes(department.id)}
              onChange={(event) =>
                actions.onScope(
                  event.target.checked
                    ? [...state.departments, department.id]
                    : state.departments.filter((id) => id !== department.id),
                )
              }
            />
            <span>{department.label}</span>
          </label>
        ))}
      </div>

      <div className="staff-add">
        <h4 className="settings-heading">Who may use it</h4>
        <p className="setting-note">Nobody, until you say so here.</p>
        {agents.map((agent) => (
          <label key={agent.id} className="setting-check">
            <input
              type="checkbox"
              checked={state.agentIds.includes(agent.id)}
              onChange={(event) =>
                actions.onSetAgents(
                  event.target.checked
                    ? [...state.agentIds, agent.id]
                    : state.agentIds.filter((id) => id !== agent.id),
                )
              }
            />
            <span>
              {agent.name ?? agent.id} — {agent.role}
              {/*
                The department fence wins over the agent's own list, so ticking
                somebody outside it does nothing. Said here rather than left as
                a connector that is switched on and still refuses.
              */}
              {state.departments.length > 0 && !state.departments.includes(agent.departmentId) && (
                <span className="setting-note"> — their department is not ticked above</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
