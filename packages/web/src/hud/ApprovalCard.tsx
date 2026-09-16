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
import {
  alwaysAllowSentence,
  canAlwaysAllow,
  matchFrom,
  type ProposedField,
  proposeMatch,
} from "./always-allow.js";

/** The exact line an MCP tool's card carries, so it can be recognised here. */
const MCP_UNKNOWN_PREFIX = "Staffroom cannot see what this server will do";

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
  whitelistDays,
}: {
  approval: PendingApprovalView;
  onDecide: (
    decision: "approve" | "deny" | "approve_always",
    note?: string,
    match?: Record<string, string>,
  ) => void;
  /** Only the oldest card listens, so one keypress can never hit two cards. */
  chords?: boolean;
  /** How long a permission lasts, so the button can say it rather than imply it. */
  whitelistDays?: number;
}): ReactElement {
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState<"approve" | "deny" | "always" | null>(null);
  const [fields, setFields] = useState<ProposedField[]>(() => proposeMatch(approval.input));
  const [allowAny, setAllowAny] = useState(false);

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
      else if (key === "s") setArmed("always");
      else if (key === "escape") setArmed(null);
      else if (event.key === "Enter" && armed !== null) {
        event.preventDefault();
        if (armed === "approve") onDecide("approve");
        // Always-allow never fires straight from a keypress. It opens the
        // confirm, because the owner should see what they are about to permit
        // before it is written down.
        else if (armed === "always") setConfirming(true);
        else setDeclining(true);
        setArmed(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chords, armed, onDecide]);

  const isMcp = approval.preview.summary.startsWith(MCP_UNKNOWN_PREFIX);
  const days = whitelistDays ?? 90;

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

      {/* Fields that only repeat the destination row above are dropped: the same
          address twice reads as a mistake rather than as emphasis. */}
      {(approval.preview.fields?.filter((f) => f.value !== approval.preview.destination).length ??
        0) > 0 && (
        <dl className="approval-fields">
          {approval.preview.fields
            ?.filter((field) => field.value !== approval.preview.destination)
            .map((field) => (
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

      {isMcp && <p className="approval-unknown">{approval.preview.summary}</p>}

      {armed !== null && (
        <p className="approval-armed" role="status">
          {armed === "approve"
            ? "Press Enter to approve."
            : armed === "always"
              ? "Press Enter to set up always allowing this."
              : "Press Enter to decline."}
        </p>
      )}

      {approval.preview.irreversible && (
        <p className="approval-warning">This cannot be undone once it is sent.</p>
      )}

      {approval.preview.changedSinceAllowed !== undefined && (
        <p className="approval-changed">
          This tool changed since you allowed it. {approval.preview.changedSinceAllowed}
        </p>
      )}

      {declining && (
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
      )}

      {confirming && (
        <div className="approval-always">
          <p className="approval-always-line">
            {alwaysAllowSentence({
              agentName: approval.agentName,
              action: approval.preview.action,
              toolName: approval.tool.name,
              fields,
            })}
          </p>

          {fields.length > 0 && (
            <dl className="approval-fields">
              {fields.map((field, index) => (
                <div key={field.name} style={{ display: "contents" }}>
                  <dt>{field.name}</dt>
                  <dd>
                    <input
                      className="approval-match"
                      value={field.value}
                      aria-label={`Allow ${field.name}`}
                      placeholder={
                        field.needsOwner ? `This call had several: ${field.actual}` : field.actual
                      }
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((f, i) =>
                            i === index ? { ...f, value: event.target.value } : f,
                          ),
                        )
                      }
                    />
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* A tool with nothing that looks like a destination cannot be pinned
              to one, so allowing it always has to be ticked deliberately. */}
          {Object.keys(matchFrom(fields)).length === 0 && (
            <label className="approval-any">
              <input
                type="checkbox"
                checked={allowAny}
                onChange={(event) => setAllowAny(event.target.checked)}
              />
              <span>Allow this with any input, not just this one</span>
            </label>
          )}

          <p className="approval-expiry">This lasts {days} days, and you can undo it any time.</p>

          <div className="approval-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canAlwaysAllow(fields, allowAny)}
              onClick={() => onDecide("approve_always", undefined, matchFrom(fields))}
            >
              Always allow
            </button>
          </div>
        </div>
      )}

      {!declining && !confirming && (
        <div className="approval-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setDeclining(true)}>
            Decline
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
            Always allow ({days} days)
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDecide("approve")}>
            Approve once
          </button>
        </div>
      )}
    </article>
  );
}
