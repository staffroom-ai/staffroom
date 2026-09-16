/**
 * What to do about the mornings the laptop was shut.
 *
 * A routine that says "every weekday at 08:00" and a machine that was asleep
 * until Thursday afternoon: the office has to decide, without asking, whether to
 * run the three summaries it missed, one of them, or none. Each answer is right
 * for something, which is why it is the owner's setting and not a guess.
 *
 * Two limits are not settings, because neither has a defensible other value:
 *
 *   Nothing older than seven days is ever run. Work from last fortnight is not
 *   work, it is an agent writing a summary of a week nobody remembers, and it
 *   would arrive looking current.
 *
 *   `all` is capped at seven. Coming back from a fortnight away to fourteen runs
 *   queued is not catching up, it is a mess to clean.
 */
import type { Routine } from "./routines.js";
import { firesBetween } from "./time.js";

/** Older than this and a missed fire is history rather than work. */
export const MAX_MISS_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** However many were missed, this many run. */
export const MAX_CATCH_UP_RUNS = 7;

/**
 * How late a fire has to be before the run says it is catching up.
 *
 * Not a count of missed fires — one missed morning is still a missed morning.
 * What makes a run a catch-up is that the office was not there when it was due,
 * and with a thirty-second tick anything more than a few minutes old means
 * exactly that. A summary of Tuesday arriving on Wednesday has to say so, or it
 * reads as a summary of Wednesday.
 */
export const LATE_ENOUGH_MS = 5 * 60 * 1000;

export interface CatchUpPlan {
  /** Instants to run for, oldest first. Empty means nothing to do. */
  runs: number[];
  /** Where `lastRunAt` should move to, whether or not anything runs. */
  lastRunAt: number;
  /** Fires that were too old to be worth running. */
  skipped: number;
  /** Set when the run should be titled as a catch-up. */
  catchUp: boolean;
}

/**
 * Decides what a routine owes after time has passed.
 *
 * `lastRunAt` moves to now in every case, including when nothing runs: the point
 * of a skip is that those fires are settled, and leaving the mark behind would
 * make the office offer them again on the next tick.
 */
export function planCatchUp(
  routine: Routine,
  lastRunAt: number,
  now: number,
  timeZone: string,
): CatchUpPlan {
  const nothing: CatchUpPlan = { runs: [], lastRunAt: now, skipped: 0, catchUp: false };
  if (routine.paused) return { ...nothing, lastRunAt };

  const missed = firesBetween(
    { cadence: routine.cadence, time: routine.time, weekday: routine.weekday, day: routine.day },
    lastRunAt,
    now,
    timeZone,
    // Fetched generously so the "too old" count is honest rather than truncated.
    MAX_CATCH_UP_RUNS * 8,
  );

  if (missed.length === 0) return nothing;

  const cutoff = now - MAX_MISS_AGE_MS;
  const recent = missed.filter((fire) => fire >= cutoff);
  const skipped = missed.length - recent.length;

  if (routine.catch_up === "skip" || recent.length === 0) {
    return { runs: [], lastRunAt: now, skipped: missed.length - recent.length, catchUp: false };
  }

  if (routine.catch_up === "all") {
    // The most recent ones, not the oldest: if some have to be dropped, the ones
    // worth keeping are the ones closest to now.
    const runs = recent.slice(-MAX_CATCH_UP_RUNS);
    return {
      runs,
      lastRunAt: now,
      skipped: skipped + (recent.length - runs.length),
      catchUp: isLate(runs[0] as number, now),
    };
  }

  // latest: one run, for the most recent fire that was missed.
  const last = recent[recent.length - 1] as number;
  return {
    runs: [last],
    lastRunAt: now,
    skipped: skipped + recent.length - 1,
    catchUp: isLate(last, now),
  };
}

/** Was the office absent when this was due? */
function isLate(fire: number, now: number): boolean {
  return now - fire > LATE_ENOUGH_MS;
}

/**
 * What the run is called.
 *
 * A catch-up says so, because a summary of Tuesday arriving on Thursday with
 * Tuesday's title reads as a summary of Thursday.
 */
export function runLabel(routine: Routine, catchUp: boolean): string {
  return catchUp ? `Catch-up: ${routine.label}` : routine.label;
}
