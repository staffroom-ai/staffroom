/**
 * Telling somebody a newer Staffroom exists, at most once a day.
 *
 * This is a network request the owner did not ask for, so it is tied to the same
 * switch as telemetry rather than being on by default. That is a stricter rule
 * than most tools apply — plenty check for updates regardless — and it is the
 * right one here: an office that phones home while the owner believes nothing
 * leaves the machine has broken the only promise the project makes, and "it was
 * only the version number" is not a defence anybody should have to accept.
 *
 * `STAFFROOM_NO_UPDATE_CHECK=1` turns it off even with telemetry on, for a
 * machine that is allowed to report counts but not to reach the registry.
 *
 * `telemetryEnabled` is the caller's answer to "may anything be sent at all",
 * not the raw config flag — demo mode sends nothing, and that includes this.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const REGISTRY = "https://registry.npmjs.org/staffroom/latest";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function updateCheckPath(home: string = homedir()): string {
  return join(home, ".staffroom", "update-check.json");
}

export interface UpdateCheckState {
  /** Epoch ms of the last completed check, successful or not. */
  checkedAt: number;
  /** What the registry said. Absent when the last check failed. */
  latest?: string;
}

export function readUpdateCheck(home?: string): UpdateCheckState {
  try {
    const parsed = JSON.parse(readFileSync(updateCheckPath(home), "utf8")) as UpdateCheckState;
    const checkedAt = typeof parsed?.checkedAt === "number" ? parsed.checkedAt : 0;
    return {
      checkedAt,
      ...(typeof parsed?.latest === "string" ? { latest: parsed.latest } : {}),
    };
  } catch {
    // Never checked, or a file somebody edited. Either way: check now.
    return { checkedAt: 0 };
  }
}

export function writeUpdateCheck(state: UpdateCheckState, home?: string): void {
  const path = updateCheckPath(home);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Unwritable means it checks again next time. Noisier than intended, and
    // never a reason to stop the office opening.
  }
}

/**
 * Is a newer version worth mentioning?
 *
 * Compared numerically, part by part, because "0.10.0" is newer than "0.9.0" and
 * a string comparison says the opposite. A version with a prerelease suffix is
 * never offered: somebody on a stable release did not ask to be told about a
 * beta.
 */
export function isNewer(latest: string, current: string): boolean {
  if (latest.includes("-") || current.includes("-")) return false;

  const parse = (v: string): number[] => v.split(".").map((p) => Number.parseInt(p, 10));
  const a = parse(latest);
  const b = parse(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export function updateLine(latest: string, current: string): string {
  return `Update available: ${latest} (you have ${current}). Run npx staffroom@latest.`;
}

export interface UpdateCheckOptions {
  current: string;
  /** The same switch as telemetry. Off means no request at all. */
  telemetryEnabled: boolean;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: number;
  /** Overridable so tests never reach the network. */
  fetchLatest?: () => Promise<string | undefined>;
}

/**
 * The line to print, or nothing.
 *
 * Returns undefined far more often than it returns a string, and every one of
 * those paths is deliberate: not opted in, turned off for this machine, checked
 * within the day, the registry did not answer, or there is simply nothing newer.
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<string | undefined> {
  const env = options.env ?? process.env;
  if (env["STAFFROOM_NO_UPDATE_CHECK"] === "1") return undefined;
  if (!options.telemetryEnabled) return undefined;

  const now = options.now ?? Date.now();
  const state = readUpdateCheck(options.home);

  // Inside the day: answer from what was cached, with no request.
  //
  // `checkedAt > 0` is said out loud rather than left to the arithmetic. With a
  // real clock `now - 0` is always larger than a day so it works either way, but
  // code whose correctness depends on the current year being after 1970 is code
  // that is right by accident.
  if (state.checkedAt > 0 && now - state.checkedAt < CHECK_INTERVAL_MS) {
    if (state.latest !== undefined && isNewer(state.latest, options.current)) {
      return updateLine(state.latest, options.current);
    }
    return undefined;
  }

  let latest: string | undefined;
  try {
    latest = await (options.fetchLatest ?? fetchLatestFromRegistry)();
  } catch {
    latest = undefined;
  }

  // The time is written whether or not it worked, so a registry that is down
  // is asked once a day rather than on every start.
  writeUpdateCheck({ checkedAt: now, ...(latest === undefined ? {} : { latest }) }, options.home);

  if (latest === undefined || !isNewer(latest, options.current)) return undefined;
  return updateLine(latest, options.current);
}

async function fetchLatestFromRegistry(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(REGISTRY, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  } finally {
    clearTimeout(timer);
  }
}
