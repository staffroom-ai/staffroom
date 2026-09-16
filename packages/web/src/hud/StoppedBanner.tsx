/**
 * When the office is not there any more.
 *
 * Staffroom runs on the owner's own machine, so "the server is down" usually
 * means they closed the Terminal window it was running in. The banner says that
 * in those words and hands them the one command that fixes it, rather than
 * showing a spinner that never resolves.
 *
 * It waits before appearing: a laptop waking from sleep drops the socket for a
 * second or two, and a banner that flashes on every blip trains people to ignore
 * it.
 */
import { type ReactElement, useEffect, useState } from "react";
import type { Connection } from "../ws.js";

export const RESTART_COMMAND = "npx staffroom";

/** How long a connection must stay down before this is worth saying. */
export const QUIET_MS = 10_000;

export function stoppedText(platform: "mac" | "windows" | "linux"): string {
  const machine = platform === "mac" ? "Mac" : platform === "windows" ? "PC" : "machine";
  const terminal = platform === "windows" ? "PowerShell" : "Terminal";
  return `Staffroom has stopped on this ${machine}. Open ${terminal} and run:`;
}

export function StoppedBanner({
  connection,
  platform,
  quietMs = QUIET_MS,
}: {
  connection: Connection;
  platform: "mac" | "windows" | "linux";
  quietMs?: number;
}): ReactElement | null {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const down = connection === "stopped" || connection === "reconnecting";

  useEffect(() => {
    if (!down) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), quietMs);
    return () => clearTimeout(timer);
  }, [down, quietMs]);

  if (!show) return null;

  return (
    <div className="stopped" role="alert">
      <p className="stopped-text">{stoppedText(platform)}</p>
      <div className="stopped-row">
        <code className="stopped-command">{RESTART_COMMAND}</code>
        <button
          type="button"
          className="btn-quiet"
          aria-label="Copy the restart command"
          onClick={() => {
            navigator.clipboard
              ?.writeText(RESTART_COMMAND)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
