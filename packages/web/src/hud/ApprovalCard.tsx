/**
 * The one thing on screen the owner has to act on.
 *
 * It shows what would be sent, where, and in full. An approval card that
 * summarises is worse than useless: someone approving a message is approving the
 * message, not a description of it. Irreversible actions say so before the
 * buttons, not after.
 */
import type { PendingApprovalView } from "@staffroom/core";
import { type ReactElement, useEffect, useState } from "react";

/**
 * A secret is shown as its shape, not its value: enough to tell two keys apart,
 * never enough to use one. Short values are hidden outright rather than reduced
 * to a hint about themselves.
 */
export function mask(value: string): string {
  if (value.length <= 8) return "•".repeat(Math.max(4, value.length));
  return `${value.slice(0, 3)}${"•".repeat(6)}${value.slice(-2)}`;
}

export function ApprovalCard({
  approval,
  onDecide,
  chords = false,
}: {
  approval: PendingApprovalView;
  onDecide: (decision: "approve" | "deny", note?: string) => void;
  /** Only the oldest card listens, so one keypress can never hit two cards. */
  chords?: boolean;
}): ReactElement {
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [armed, setArmed] = useState<"approve" | "deny" | null>(null);

  // A then Enter, R then Enter. A single key must never send something on the
  // owner's behalf, so the first press only arms and says so.
  useEffect(() => {
    if (!chords) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement?.tagName;
      if (active === "INPUT" || active === "TEXTAREA") return;

      const key = event.key.toLowerCase();
      if (key === "a") setArmed("approve");
      else if (key === "r") setArmed("deny");
      else if (key === "escape") setArmed(null);
      else if (event.key === "Enter" && armed !== null) {
        event.preventDefault();
        if (armed === "approve") onDecide("approve");
        else setDeclining(true);
        setArmed(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chords, armed, onDecide]);

  return (
    <article className="approval" aria-label={`${approval.agentName} needs permission`}>
      <header className="approval-head">
        <span className="approval-who">{approval.agentName}</span>
        <span className="approval-what">{approval.preview.action}</span>
      </header>

      <dl className="approval-fields">
        <dt>To</dt>
        <dd>{approval.preview.destination}</dd>
        <dt>Using</dt>
        <dd className="mono">{approval.tool.name}</dd>
      </dl>

      {(approval.preview.fields?.length ?? 0) > 0 && (
        <dl className="approval-fields">
          {approval.preview.fields?.map((field) => (
            <div key={field.name} style={{ display: "contents" }}>
              <dt>{field.name}</dt>
              <dd className={field.sensitive === true ? "mono is-masked" : "mono"}>
                {field.sensitive === true ? mask(field.value) : field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* The whole thing, never a summary. */}
      <pre className="approval-body">{approval.preview.body}</pre>

      {armed !== null && (
        <p className="approval-armed" role="status">
          {armed === "approve" ? "Press Enter to approve." : "Press Enter to decline."}
        </p>
      )}

      {approval.preview.irreversible && (
        <p className="approval-warning">This cannot be undone once it is sent.</p>
      )}

      {approval.preview.changedSinceAllowed !== undefined && (
        <p className="approval-warning">
          This changed since you allowed it: {approval.preview.changedSinceAllowed}
        </p>
      )}

      {declining ? (
        <div className="approval-decline">
          <input
            className="approval-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell them why, so they can try something else"
            aria-label="Why you are declining"
          />
          <div className="approval-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setDeclining(false)}>
              Back
            </button>
            <button type="button" className="btn btn-danger" onClick={() => onDecide("deny", note)}>
              Decline
            </button>
          </div>
        </div>
      ) : (
        <div className="approval-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setDeclining(true)}>
            Decline
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDecide("approve")}>
            Approve
          </button>
        </div>
      )}
    </article>
  );
}
