/**
 * Talking to one member of staff.
 *
 * The rail's other two tabs are about the office as a whole; this is about one
 * person. It is also where a finished piece of work turns into something the
 * owner can act on: read it, open the file, or ask for a second pass.
 */
import type { Agent, DeliverableSummary } from "@staffroom/core";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { ChatTurn } from "../store.js";

const MAX_NAME = 40;

/** What the file manager is called, so the button never lies about the OS. */
export function revealLabel(platform: "mac" | "windows" | "linux"): string {
  if (platform === "windows") return "Show in Explorer";
  if (platform === "linux") return "Show in file manager";
  return "Show in Finder";
}

/**
 * The name is edited in place rather than in a settings screen, because renaming
 * the staff is the first thing an owner does and it should feel like naming, not
 * configuring. Blank or over-long reverts rather than erroring: there is nothing
 * to warn about, the edit simply did not take.
 */
function EditableName({
  agent,
  onRename,
}: {
  agent: Agent;
  onRename: (name: string) => void;
}): ReactElement {
  const shown = agent.name ?? agent.id;
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(shown);
  }, [shown]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (): void => {
    const name = draft.trim();
    setEditing(false);
    if (name.length === 0 || name.length > MAX_NAME || name === shown) {
      setDraft(shown);
      return;
    }
    onRename(name);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="chat-name"
        onClick={() => setEditing(true)}
        aria-label={`Rename ${shown}`}
      >
        {shown}
      </button>
    );
  }

  return (
    <input
      ref={input}
      className="chat-name-input"
      value={draft}
      maxLength={MAX_NAME}
      aria-label={`Name for ${agent.role}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          setDraft(shown);
          setEditing(false);
        }
      }}
    />
  );
}

/**
 * What came out of the work. The whole point of the product is that this is a
 * real file you own, so the card leads with opening it rather than with the text.
 */
function DeliverableCard({
  deliverable,
  revealText,
  onOpen,
  onReveal,
  onRevise,
}: {
  deliverable: DeliverableSummary;
  revealText: string;
  onOpen: () => void;
  onReveal: () => void;
  onRevise: () => void;
}): ReactElement {
  return (
    <article className="deliverable" aria-label={`Result: ${deliverable.title}`}>
      <h3 className="deliverable-title">{deliverable.title}</h3>
      <p className="deliverable-meta">
        {deliverable.agentName ?? deliverable.agentId} · {deliverable.noteId}
      </p>
      <div className="deliverable-actions">
        <button type="button" className="btn" onClick={onOpen}>
          Open in brain
        </button>
        <button type="button" className="btn-quiet" onClick={onReveal}>
          {revealText}
        </button>
        <button type="button" className="btn-quiet" onClick={onRevise}>
          Revise
        </button>
      </div>
    </article>
  );
}

export function Chat({
  agent,
  turns,
  deliverable,
  platform,
  onRename,
  onSend,
  onOpenNote,
  onReveal,
}: {
  agent: Agent | undefined;
  turns: ChatTurn[];
  deliverable: DeliverableSummary | undefined;
  platform: "mac" | "windows" | "linux";
  onRename: (agentId: string, name: string) => void;
  onSend: (agentId: string, text: string) => void;
  onOpenNote: (noteId: string) => void;
  onReveal: (noteId: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const turnCount = turns.length;

  // The count is read here, not just listed: an empty chat has nothing to follow,
  // and a dependency that the body never touches is a lie the linter is right about.
  useEffect(() => {
    const node = scroll.current;
    if (node === null || turnCount === 0) return;
    node.scrollTop = node.scrollHeight;
  }, [turnCount]);

  if (agent === undefined) {
    return (
      <div className="chat-empty">
        <p className="rail-empty">Nobody is selected.</p>
        <p className="rail-empty-hint">
          Pick someone from the Staff list to talk to them on their own.
        </p>
      </div>
    );
  }

  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    onSend(agent.id, text);
    setDraft("");
  };

  return (
    <div className="chat">
      <header className="chat-head">
        <div className="chat-who">
          <EditableName agent={agent} onRename={(name) => onRename(agent.id, name)} />
          <span className="chat-role">{agent.role}</span>
        </div>
        <div className="chat-chips">
          <span className="chip mono" title="To change role or model, edit office/agents.yaml.">
            {agent.model}
          </span>
          {agent.local && (
            <span className="chip chip-local" title="This model runs on this machine.">
              local
            </span>
          )}
        </div>
      </header>

      <div className="chat-scroll" ref={scroll}>
        {turnCount === 0 && (
          <p className="rail-empty-hint">
            Nothing yet. Ask {agent.name ?? agent.id} for something below.
          </p>
        )}

        {turns.map((turn) => (
          <p key={`${turn.runId}-${turn.role}-${turn.at}`} className={`bubble bubble-${turn.role}`}>
            {turn.text}
          </p>
        ))}

        {deliverable !== undefined && (
          <DeliverableCard
            deliverable={deliverable}
            revealText={revealLabel(platform)}
            onOpen={() => onOpenNote(deliverable.noteId)}
            onReveal={() => onReveal(deliverable.noteId)}
            onRevise={() => setDraft("revise: ")}
          />
        )}
      </div>

      <div className="chat-compose">
        <input
          className="chat-input"
          value={draft}
          placeholder={`Ask ${agent.name ?? agent.id} for something`}
          aria-label={`Message ${agent.name ?? agent.id}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
        />
        <button type="button" className="btn" onClick={send} disabled={draft.trim().length === 0}>
          Send
        </button>
      </div>
    </div>
  );
}
