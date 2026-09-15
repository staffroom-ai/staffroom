/**
 * The right rail: what is happening, what came out, and what needs the owner.
 *
 * The scene shows that work is happening. This shows what the work was. Without
 * it the office is a picture of an office, which was the state of this app until
 * now: you could give someone a task and never read what they wrote.
 *
 * Approvals come first whenever there are any. Everything else can wait; that
 * cannot.
 */
import type { DeliverableSummary, OfficeState, PendingApprovalView } from "@staffroom/core";
import { type ReactElement, useEffect, useRef } from "react";
import type { ActivityLine } from "../cues.js";
import { ApprovalCard } from "./ApprovalCard.js";

export type RailTab = "activity" | "results";

function timeOf(at: number | string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Empty({ children, hint }: { children: string; hint: string }): ReactElement {
  return (
    <>
      <p className="rail-empty">{children}</p>
      <p className="rail-empty-hint">{hint}</p>
    </>
  );
}

/**
 * What the office has to show for itself, across the top of the rail.
 *
 * Three numbers rather than a 750-pixel column holding one sentence: how much is
 * running, how much has been filed, and how much is stuck waiting for the owner.
 */
function Ledger({ state }: { state: OfficeState }): ReactElement {
  const waiting = state.approvals.length;
  return (
    <div className="ledger">
      <div className="ledger-cell">
        <span className="ledger-value">{state.runs.length}</span>
        <span className="ledger-label">In progress</span>
      </div>
      <div className="ledger-cell">
        <span className="ledger-value">{state.latestDeliverables.length}</span>
        <span className="ledger-label">Filed</span>
      </div>
      <div className={`ledger-cell${waiting > 0 ? " is-waiting" : ""}`}>
        <span className="ledger-value">{waiting}</span>
        <span className="ledger-label">Waiting on you</span>
      </div>
    </div>
  );
}

export function Rail({
  state,
  activity,
  tab,
  onTab,
  onDecide,
  onOpenNote,
  error,
}: {
  state: OfficeState;
  activity: ActivityLine[];
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  onDecide: (approval: PendingApprovalView, decision: "approve" | "deny", note?: string) => void;
  onOpenNote: (noteId: string) => void;
  error: { code: string; message: string; hint: string } | undefined;
}): ReactElement {
  const feed = useRef<HTMLDivElement>(null);

  // Follow the feed, because the newest line is the one being waited on.
  const lineCount = activity.length;
  useEffect(() => {
    const node = feed.current;
    if (node === null || lineCount === 0) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [lineCount]);

  return (
    <aside className="rail" aria-label="What the office is doing">
      <Ledger state={state} />

      {error !== undefined && (
        <div className="rail-error" role="alert">
          <p className="rail-error-message">{error.message}</p>
          <p className="rail-error-hint">{error.hint}</p>
        </div>
      )}

      {state.approvals.length > 0 && (
        <section className="rail-section rail-approvals" aria-label="Waiting for you">
          <h2 className="rail-heading">
            Waiting for you
            <span className="rail-count">{state.approvals.length}</span>
          </h2>
          {state.approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onDecide={(decision, note) => onDecide(approval, decision, note)}
            />
          ))}
        </section>
      )}

      <nav className="rail-tabs" aria-label="Rail sections">
        <button
          type="button"
          className={`rail-tab${tab === "activity" ? " is-on" : ""}`}
          onClick={() => onTab("activity")}
          aria-pressed={tab === "activity"}
        >
          Activity
        </button>
        <button
          type="button"
          className={`rail-tab${tab === "results" ? " is-on" : ""}`}
          onClick={() => onTab("results")}
          aria-pressed={tab === "results"}
        >
          Results
          {state.latestDeliverables.length > 0 && (
            <span className="rail-count">{state.latestDeliverables.length}</span>
          )}
        </button>
      </nav>

      {tab === "activity" ? (
        <div className="rail-feed" ref={feed} aria-live="polite">
          {activity.length === 0 ? (
            <Empty hint="Pick a department in the bar below, say what you need in a sentence, and every step they take shows up here.">
              Nothing has happened yet.
            </Empty>
          ) : (
            activity.map((line) => (
              <p key={line.id} className={`feed-line feed-${line.tone}`}>
                <time className="feed-time">{timeOf(line.at)}</time>
                <span className="feed-text">{line.text}</span>
              </p>
            ))
          )}
        </div>
      ) : (
        <div className="rail-feed">
          {state.latestDeliverables.length === 0 ? (
            <Empty hint="Every finished piece of work is saved as a file in your notes folder, and listed here so you can open it.">
              No finished work yet.
            </Empty>
          ) : (
            state.latestDeliverables.map((d: DeliverableSummary) => (
              <button
                key={d.noteId}
                type="button"
                className="result"
                onClick={() => onOpenNote(d.noteId)}
                title="Show this file on your computer"
              >
                <span className="result-title">{d.title}</span>
                <span className="result-meta">
                  {d.agentName ?? d.agentId} · {timeOf(d.createdAt)}
                </span>
                <span className="result-path mono">{d.noteId}.md</span>
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
