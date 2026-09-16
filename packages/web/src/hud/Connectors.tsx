/**
 * What the office is connected to, and whether it is working.
 *
 * This is the only place an owner finds out that a server they configured is not
 * answering, so it has to be readable at a glance and honest when it is bad
 * news. Health is never carried by colour alone: every state has a word in the
 * hover card and in the button's accessible name, because a red dot to somebody
 * who cannot see red is no dot at all.
 *
 * A connector that is stuck gets a button rather than a sentence. "Needs you to
 * sign in" is a diagnosis; Connect is a fix, and the difference is most of what
 * makes a broken integration recoverable by the person who set it up.
 */
import type { Connector } from "@staffroom/core";
import { type ReactElement, useState } from "react";

/** The word for each state. Also the accessible name, so nothing is colour-only. */
export const HEALTH_WORD: Record<Connector["health"], string> = {
  ok: "working",
  starting: "starting up",
  auth_required: "needs you to sign in",
  down: "not answering",
  load_failed: "could not be loaded",
  denied: "not allowed",
  grey: "not set up",
};

/** States the owner can do something about, which is also what sorts first. */
export function needsAttention(health: Connector["health"]): boolean {
  return health === "auth_required" || health === "down" || health === "load_failed";
}

/** Two initials is enough to tell notion from stripe at twenty-four pixels. */
export function initials(label: string): string {
  const parts = label.split(/[^a-z0-9]+/i).filter(Boolean);
  const first = parts[0];
  if (first === undefined) return "?";
  const second = parts[1];
  if (second === undefined) return first.slice(0, 2).toUpperCase();
  return `${first[0]}${second[0]}`.toUpperCase();
}

const KIND_RANK: Record<Connector["kind"], number> = { mcp: 0, custom: 1, builtin: 2 };

/**
 * Ordered by kind, then by how recently it was used.
 *
 * With one exception, which is the point of the strip: anything the owner could
 * fix comes first regardless. A bar that buries a broken connector behind four
 * working ones has failed at the only job it has.
 */
export function order(connectors: Connector[]): Connector[] {
  return [...connectors].sort((a, b) => {
    const attention = Number(needsAttention(b.health)) - Number(needsAttention(a.health));
    if (attention !== 0) return attention;
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    const aUsed = a.lastUsedAt === null ? 0 : Date.parse(a.lastUsedAt);
    const bUsed = b.lastUsedAt === null ? 0 : Date.parse(b.lastUsedAt);
    if (aUsed !== bUsed) return bUsed - aUsed;
    return a.label.localeCompare(b.label);
  });
}

const KIND_WORD: Record<Connector["kind"], string> = {
  mcp: "MCP server",
  custom: "your own tool",
  builtin: "built in",
};

/** "3 tools", but "1 tool". */
export function toolCountWord(count: number): string {
  return count === 1 ? "1 tool" : `${count} tools`;
}

export function whereWord(departments: Connector["departments"]): string {
  if (departments === "all") return "every department";
  if (departments.length === 0) return "nobody yet";
  return departments.join(", ");
}

function Card({ connector }: { connector: Connector }): ReactElement {
  return (
    <div className="conn-card">
      <p className="conn-card-name">{connector.label}</p>
      <p className={`conn-card-health conn-word-${connector.health}`}>
        {HEALTH_WORD[connector.health]}
      </p>
      {connector.message !== null && <p className="conn-card-message">{connector.message}</p>}
      <p className="conn-card-facts">
        {KIND_WORD[connector.kind]} · {toolCountWord(connector.toolCount)} ·{" "}
        {whereWord(connector.departments)}
      </p>
    </div>
  );
}

export function Connectors({
  connectors,
  onSignIn,
  onReconnect,
}: {
  connectors: Connector[];
  onSignIn: (server: string) => void;
  onReconnect: (server: string) => void;
}): ReactElement | null {
  /*
   * Hovering and pinning are two different things, and conflating them is how a
   * card that opens on hover closes itself the instant it is clicked: the click
   * arrives on something already open and reads as "close". So hover and focus
   * open the card while the pointer is there, and a click keeps it open after
   * the pointer leaves — which is what the owner wants when they are reaching
   * for the Connect button inside it.
   */
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = order(connectors);
  if (shown.length === 0) return null;

  const close = (id: string): void => {
    setHovered((current) => (current === id ? null : current));
    setPinned((current) => (current === id ? null : current));
  };

  return (
    // A list, not a row of divs: the wrapper needs a real role to carry a label,
    // and each item needs one to be allowed to notice the pointer at all.
    <ul className="connectors" aria-label="Connected to">
      {shown.map((connector) => {
        const isOpen = hovered === connector.id || pinned === connector.id;
        const word = HEALTH_WORD[connector.health];

        return (
          // The card hangs off the wrapper, not the button, so the pointer can
          // travel from the logo into the card without the card closing on it.
          <li
            className="conn"
            key={connector.id}
            onMouseEnter={() => {
              setHovered(connector.id);
              // Moving to another connector puts the pinned one away: two cards
              // open at once is two answers to a question with one answer.
              setPinned((id) => (id === connector.id ? id : null));
            }}
            onMouseLeave={() => setHovered((id) => (id === connector.id ? null : id))}
          >
            <button
              type="button"
              className={`conn-chip conn-${connector.health}${connector.pulse > 0 ? " is-busy" : ""}`}
              aria-label={`${connector.label}: ${word}`}
              aria-expanded={isOpen}
              onClick={() => setPinned((id) => (id === connector.id ? null : connector.id))}
              onFocus={() => setHovered(connector.id)}
              onKeyDown={(event) => {
                if (event.key === "Escape") close(connector.id);
              }}
              onBlur={(event) => {
                if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
                  close(connector.id);
                }
              }}
            >
              <span className="conn-initials">{initials(connector.label)}</span>
              {connector.health === "denied" && (
                <span className="conn-lock" aria-hidden="true">
                  ×
                </span>
              )}
              <span className="conn-dot" aria-hidden="true" />
            </button>

            {isOpen && (
              <div className="conn-pop">
                <Card connector={connector} />
                {connector.health === "auth_required" && (
                  <button type="button" className="conn-fix" onClick={() => onSignIn(connector.id)}>
                    Connect
                  </button>
                )}
                {(connector.health === "down" || connector.health === "load_failed") && (
                  <button
                    type="button"
                    className="conn-fix"
                    onClick={() => onReconnect(connector.id)}
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
