/**
 * The one thing on screen the owner has to act on.
 *
 * It shows what would be sent, where, and in full. An approval card that
 * summarises is worse than useless: someone approving a message is approving the
 * message, not a description of it. Irreversible actions say so before the
 * buttons, not after.
 */
import type { PendingApprovalView } from "@staffroom/core";
import { type ReactElement, useState } from "react";

export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: PendingApprovalView;
  onDecide: (decision: "approve" | "deny", note?: string) => void;
}): ReactElement {
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);

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

      {/* The whole thing, never a summary. */}
      <pre className="approval-body">{approval.preview.body}</pre>

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
