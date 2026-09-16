/**
 * Everything that happened, newest last, and a way to find one thing in it.
 *
 * The feed is the office's account of its own work, so it is never summarised and
 * never silently dropped. Once an office has been running a while the problem is
 * not seeing events, it is finding the one you care about, which is what the
 * filter and the search are for.
 *
 * Tool cards live in the feed rather than as toasts on purpose. A toast about a
 * tool that will not compile disappears before the owner has read the line number.
 */
import type { OfficeState } from "@staffroom/core";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { ActivityLine } from "../cues.js";
import type { ToolNotice } from "../store.js";
import {
  asksWhoMayUse,
  assignText,
  failureDetail,
  failureText,
  noScopeText,
  toolOf,
} from "./tool-cards.js";

function timeOf(at: number | string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Anything the owner might want to copy out of the office and paste somewhere
 * else — a compiler error, usually, on its way to whatever wrote the tool.
 */
function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className="btn-quiet"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => setDone(true))
          .catch(() => setDone(false));
      }}
      aria-label={label}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function ToolCard({
  notice,
  state,
  onAssign,
  onDismiss,
}: {
  notice: ToolNotice;
  state: OfficeState;
  onAssign: (tool: string, agentIds: string[]) => void;
  onDismiss: () => void;
}): ReactElement {
  const [checked, setChecked] = useState<string[]>([]);

  if (!notice.ok) {
    const detail = failureDetail(notice);
    return (
      <article className="tool-card tool-card-bad" role="alert">
        <p className="tool-card-text">{failureText(notice)}</p>
        <div className="tool-card-actions">
          {/* File, line and message together: what an owner would otherwise
              retype into an issue by hand, and get wrong. */}
          <CopyButton text={`${notice.file}: ${detail}`} label="Copy the tool error" />
          <button type="button" className="btn-quiet" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </article>
    );
  }

  const tool = toolOf(notice);
  // Whoever the office knew when it sent the card, falling back to the roster in
  // front of us if it did not say.
  const people = notice.agents ?? state.agents.map((a) => ({ id: a.id, name: a.name ?? a.id }));

  // The scope warning is not a card of its own: a new tool with no scope is one
  // save, and the owner should read one card about it.
  const scopeWarning =
    notice.warning === "no_scope" ? (
      <p className="tool-card-warn">{noScopeText(notice.file)}</p>
    ) : null;

  if (!asksWhoMayUse(notice) || tool === undefined) {
    return (
      <article className="tool-card">
        <p className="tool-card-text">
          {tool === undefined ? `${notice.file} was reloaded.` : `${tool} was reloaded.`}
        </p>
        {scopeWarning}
        <div className="tool-card-actions">
          <button type="button" className="btn-quiet" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="tool-card">
      <p className="tool-card-text">{assignText(tool)}</p>
      {scopeWarning}

      <div className="tool-card-people">
        {people.map((agent) => (
          <label className="tool-check" key={agent.id}>
            <input
              type="checkbox"
              // The label wraps this, but a bare checkbox in a row of four reads
              // as "checkbox, on" four times over without one.
              aria-label={agent.name}
              checked={checked.includes(agent.id)}
              onChange={(event) =>
                setChecked((prev) =>
                  event.target.checked ? [...prev, agent.id] : prev.filter((id) => id !== agent.id),
                )
              }
            />
            <span>{agent.name}</span>
          </label>
        ))}
      </div>

      <div className="tool-card-actions">
        <button
          type="button"
          className="btn"
          disabled={checked.length === 0}
          onClick={() => {
            onAssign(tool, checked);
            onDismiss();
          }}
        >
          Save
        </button>
        <button type="button" className="btn-quiet" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </article>
  );
}

export function Activity({
  state,
  activity,
  notices,
  onAssign,
  onDismissNotice,
}: {
  state: OfficeState;
  activity: ActivityLine[];
  notices: ToolNotice[];
  onAssign: (tool: string, agentIds: string[]) => void;
  onDismissNotice: (id: number) => void;
}): ReactElement {
  const feed = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [who, setWho] = useState("");

  // `/` jumps to the search, the way it does in every tool that has a long list.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement?.tagName;
      if (active === "INPUT" || active === "TEXTAREA") return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const shown = activity.filter((line) => {
    if (who.length > 0 && line.agentId !== who) return false;
    if (needle.length > 0 && !line.text.toLowerCase().includes(needle)) return false;
    return true;
  });

  // Follow the feed, but only when nothing is being looked for: yanking the view
  // to the bottom while someone is reading a filtered result is hostile.
  const shownCount = shown.length;
  const filtering = needle.length > 0 || who.length > 0;
  useEffect(() => {
    const node = feed.current;
    if (node === null || filtering || shownCount === 0) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [shownCount, filtering]);

  return (
    <>
      {activity.length > 0 && (
        <div className="feed-filters">
          <input
            ref={search}
            className="feed-search"
            value={query}
            placeholder="Search what happened"
            aria-label="Search the activity"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="feed-who"
            value={who}
            aria-label="Filter by person"
            onChange={(event) => setWho(event.target.value)}
          >
            <option value="">Everyone</option>
            {state.agents.map((agent) => (
              <option value={agent.id} key={agent.id}>
                {agent.name ?? agent.id}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="rail-feed" ref={feed} aria-live="polite">
        {notices.map((notice) => (
          <ToolCard
            key={notice.id}
            notice={notice}
            state={state}
            onAssign={onAssign}
            onDismiss={() => onDismissNotice(notice.id)}
          />
        ))}

        {activity.length === 0 && notices.length === 0 && (
          <>
            <p className="rail-empty">Nothing has happened yet.</p>
            <p className="rail-empty-hint">
              Pick a department in the bar below, say what you need in a sentence, and every step
              they take shows up here.
            </p>
          </>
        )}

        {activity.length > 0 && shown.length === 0 && (
          <p className="rail-empty-hint">Nothing here matches that.</p>
        )}

        {shown.map((line) => (
          <p key={line.id} className={`feed-line feed-${line.tone}`}>
            <time className="feed-time">{timeOf(line.at)}</time>
            <span className="feed-text">{line.text}</span>
          </p>
        ))}
      </div>
    </>
  );
}
