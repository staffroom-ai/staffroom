/**
 * What the office does about the mornings the laptop was shut.
 *
 * Every rule here is about not doing the wrong thing while nobody was watching.
 * Running three days of missed summaries when the owner wanted one, or running
 * last fortnight's work as though it were this morning's, are both worse than
 * doing nothing — so each is pinned.
 */
import { describe, expect, it } from "vitest";
import { MAX_CATCH_UP_RUNS, MAX_MISS_AGE_MS, planCatchUp, runLabel } from "./catchup.js";
import type { Routine } from "./routines.js";
import { instantOf, wallClockAt } from "./time.js";

const MELBOURNE = "Australia/Melbourne";

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "daily-inbox-summary",
    label: "Morning inbox summary",
    agent: "researcher",
    task: "Summarise anything new in the inbox.",
    cadence: "weekdays",
    time: "08:00",
    approval_before_send: true,
    catch_up: "latest",
    paused: false,
    ...overrides,
  };
}

/** A wall-clock moment in Melbourne, which is how these are reasoned about. */
function at(day: number, hour: number, minute = 0, month = 4): number {
  return instantOf({ year: 2026, month, day, hour, minute }, MELBOURNE);
}

const readsAs = (instant: number): string => {
  const w = wallClockAt(instant, MELBOURNE);
  return `${String(w.day).padStart(2, "0")} ${String(w.hour).padStart(2, "0")}:${String(
    w.minute,
  ).padStart(2, "0")}`;
};

describe("nothing was missed", () => {
  it("plans no runs", () => {
    // Monday 09:00 to Monday 10:00: 08:00 already went.
    const plan = planCatchUp(routine(), at(6, 9), at(6, 10), MELBOURNE);
    expect(plan.runs).toEqual([]);
  });

  it("does not move the mark for a paused routine", () => {
    const paused = at(6, 9);
    const plan = planCatchUp(routine({ paused: true }), paused, at(10, 9), MELBOURNE);

    // Unpausing should not then produce four days of catch-up, but the mark
    // staying put is what makes "resume where we were" possible at all.
    expect(plan.runs).toEqual([]);
    expect(plan.lastRunAt).toBe(paused);
  });
});

describe("catch_up: latest", () => {
  it("runs once after a long sleep, however many were missed", () => {
    // Monday 09:00 to Thursday 09:00: Tuesday, Wednesday and Thursday missed.
    const plan = planCatchUp(routine(), at(6, 9), at(9, 9), MELBOURNE);

    expect(plan.runs).toHaveLength(1);
    expect(readsAs(plan.runs[0] as number)).toBe("09 08:00");
    expect(plan.skipped).toBe(2);
    expect(plan.catchUp).toBe(true);
  });

  it("runs the acceptance case: 26 hours on a fake clock, once, as a catch-up", () => {
    const start = at(6, 9);
    const plan = planCatchUp(routine(), start, start + 26 * 60 * 60 * 1000, MELBOURNE);

    expect(plan.runs).toHaveLength(1);
    expect(plan.catchUp).toBe(true);
    expect(runLabel(routine(), plan.catchUp)).toBe("Catch-up: Morning inbox summary");
  });

  it("does not call an ordinary on-time fire a catch-up", () => {
    // The tick a moment after 08:00 on the only day that was due.
    const plan = planCatchUp(routine(), at(6, 9), at(7, 8, 1), MELBOURNE);

    expect(plan.runs).toHaveLength(1);
    expect(plan.catchUp).toBe(false);
    expect(runLabel(routine(), plan.catchUp)).toBe("Morning inbox summary");
  });
});

describe("catch_up: all", () => {
  it("runs one per missed morning, oldest first", () => {
    const plan = planCatchUp(routine({ catch_up: "all" }), at(6, 9), at(9, 9), MELBOURNE);

    expect(plan.runs.map(readsAs)).toEqual(["07 08:00", "08 08:00", "09 08:00"]);
  });

  it("stops at seven, because coming back to fourteen is a mess rather than a catch-up", () => {
    const plan = planCatchUp(
      routine({ catch_up: "all", cadence: "daily" }),
      at(1, 9, 0, 3),
      at(1, 9),
      MELBOURNE,
    );

    expect(plan.runs.length).toBeLessThanOrEqual(MAX_CATCH_UP_RUNS);
    expect(plan.skipped).toBeGreaterThan(0);
  });

  it("keeps the most recent ones when it has to drop some", () => {
    const now = at(1, 9);
    const plan = planCatchUp(
      routine({ catch_up: "all", cadence: "daily" }),
      at(1, 9, 0, 3),
      now,
      MELBOURNE,
    );

    // If some have to go, the ones worth keeping are the ones closest to now.
    const newest = plan.runs[plan.runs.length - 1] as number;
    expect(now - newest).toBeLessThan(24 * 60 * 60 * 1000);
  });
});

describe("catch_up: skip", () => {
  it("runs nothing and moves on", () => {
    const now = at(9, 9);
    const plan = planCatchUp(routine({ catch_up: "skip" }), at(6, 9), now, MELBOURNE);

    expect(plan.runs).toEqual([]);
    // The mark still moves: the point of a skip is that those fires are settled,
    // and leaving it behind would offer them again on the next tick.
    expect(plan.lastRunAt).toBe(now);
  });
});

describe("work that is too old to be work", () => {
  it("never runs a fire from more than a week ago", () => {
    const now = at(20, 9);
    const plan = planCatchUp(routine(), now - MAX_MISS_AGE_MS * 3, now, MELBOURNE);

    for (const fire of plan.runs) {
      expect(now - fire).toBeLessThanOrEqual(MAX_MISS_AGE_MS);
    }
  });

  it("counts what it refused, so the office can say so", () => {
    const now = at(20, 9);
    const plan = planCatchUp(
      routine({ catch_up: "all" }),
      now - MAX_MISS_AGE_MS * 3,
      now,
      MELBOURNE,
    );

    expect(plan.skipped).toBeGreaterThan(0);
  });

  it("runs nothing at all when every miss is ancient", () => {
    // A machine that was off for a month: there is no morning summary worth
    // writing now, and one would arrive looking current.
    const now = at(20, 9);
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const plan = planCatchUp(routine(), monthAgo, monthAgo + 60_000, MELBOURNE);

    expect(plan.runs).toEqual([]);
  });
});

describe("the mark", () => {
  it("moves to now whenever anything was considered", () => {
    const now = at(9, 9);
    for (const rule of ["latest", "all", "skip"] as const) {
      expect(planCatchUp(routine({ catch_up: rule }), at(6, 9), now, MELBOURNE).lastRunAt).toBe(
        now,
      );
    }
  });
});
