/**
 * Fire times in the owner's own timezone.
 *
 * This is the file daylight saving is fought in. A routine that says "every
 * weekday at 08:00" has to be at 08:00 on the owner's clock in March and in
 * July, and the two instants are an hour apart in UTC. Getting that wrong is not
 * a visible bug — it is a summary that quietly arrives at seven for half the
 * year — so the two awkward days are pinned here by date.
 *
 * Melbourne is the studio template's timezone and goes the opposite way round
 * the year from the northern hemisphere, which makes it a good thing to test
 * with: a mistake that assumes the northern calendar shows up immediately.
 */
import { describe, expect, it } from "vitest";
import { firesBetween, instantOf, isKnownZone, nextFireAfter, wallClockAt } from "./time.js";

const MELBOURNE = "Australia/Melbourne";
const LONDON = "Europe/London";

/** What the clock reads there, as "YYYY-MM-DD HH:MM", for readable assertions. */
function readsAs(instant: number, zone: string): string {
  const w = wallClockAt(instant, zone);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

describe("reading a clock in another zone", () => {
  it("knows what Melbourne says at a known instant", () => {
    // 2026-03-02T21:00Z is 08:00 on the 3rd in Melbourne, which is AEDT (+11).
    expect(readsAs(Date.parse("2026-03-02T21:00:00Z"), MELBOURNE)).toBe("2026-03-03 08:00");
  });

  it("knows the same instant in a different zone", () => {
    expect(readsAs(Date.parse("2026-03-02T21:00:00Z"), LONDON)).toBe("2026-03-02 21:00");
  });

  it("renders midnight as zero rather than twenty-four", () => {
    expect(readsAs(Date.parse("2026-03-02T13:00:00Z"), MELBOURNE)).toBe("2026-03-03 00:00");
  });
});

describe("finding the instant behind a wall clock", () => {
  it("is +11 in Melbourne's summer", () => {
    const instant = instantOf({ year: 2026, month: 3, day: 3, hour: 8, minute: 0 }, MELBOURNE);
    expect(new Date(instant).toISOString()).toBe("2026-03-02T21:00:00.000Z");
  });

  it("is +10 in Melbourne's winter", () => {
    // Same wall clock, four months later, one hour's difference in UTC.
    const instant = instantOf({ year: 2026, month: 7, day: 1, hour: 8, minute: 0 }, MELBOURNE);
    expect(new Date(instant).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("round-trips: the instant reads back as the wall clock asked for", () => {
    for (const month of [1, 4, 7, 10]) {
      const wall = { year: 2026, month, day: 15, hour: 8, minute: 0 };
      expect(readsAs(instantOf(wall, MELBOURNE), MELBOURNE)).toBe(
        `2026-${String(month).padStart(2, "0")}-15 08:00`,
      );
    }
  });
});

describe("a weekday routine across a daylight-saving change", () => {
  const schedule = { cadence: "weekdays" as const, time: "08:00" };

  /*
   * Melbourne leaves daylight saving on the first Sunday in April 2026 — the 5th
   * — and goes back on the first Sunday in October. Both sides of both are
   * pinned, because a routine drifting by an hour twice a year is exactly the
   * bug this code exists to not have.
   */
  // Anchored on the office's own clock, not on a UTC instant. Picking "the
  // start of the 2nd in UTC" is already mid-morning in Melbourne, which is the
  // very confusion this module exists to remove.
  it("fires at 08:00 AEDT before the April change", () => {
    const wednesdayEvening = instantOf(
      { year: 2026, month: 4, day: 1, hour: 18, minute: 0 },
      MELBOURNE,
    );
    const fire = nextFireAfter(schedule, wednesdayEvening, MELBOURNE);

    expect(readsAs(fire as number, MELBOURNE)).toBe("2026-04-02 08:00");
    // AEDT, +11.
    expect(new Date(fire as number).toISOString()).toBe("2026-04-01T21:00:00.000Z");
  });

  it("fires at 08:00 AEST after it, which is a different UTC instant", () => {
    const sundayAfternoon = instantOf(
      { year: 2026, month: 4, day: 5, hour: 15, minute: 0 },
      MELBOURNE,
    );
    const fire = nextFireAfter(schedule, sundayAfternoon, MELBOURNE);

    expect(readsAs(fire as number, MELBOURNE)).toBe("2026-04-06 08:00");
    // AEST, +10: an hour later in UTC than the same wall clock four days before.
    expect(new Date(fire as number).toISOString()).toBe("2026-04-05T22:00:00.000Z");
  });

  it("stays at 08:00 on the owner's clock right through the change", () => {
    let cursor = Date.parse("2026-03-30T00:00:00Z");
    const seen: string[] = [];

    for (let i = 0; i < 10; i++) {
      const fire = nextFireAfter(schedule, cursor, MELBOURNE);
      if (fire === undefined) break;
      seen.push(readsAs(fire, MELBOURNE).slice(11));
      cursor = fire;
    }

    expect(new Set(seen)).toEqual(new Set(["08:00"]));
  });

  it("skips the weekend, in the office's own calendar", () => {
    // Friday 3 April 2026 in Melbourne; the next fire is the Monday.
    const friday = instantOf({ year: 2026, month: 4, day: 3, hour: 9, minute: 0 }, MELBOURNE);
    const fire = nextFireAfter(schedule, friday, MELBOURNE);
    expect(readsAs(fire as number, MELBOURNE)).toBe("2026-04-06 08:00");
  });
});

describe("the other cadences", () => {
  it("daily fires every day, including weekends", () => {
    const saturday = instantOf({ year: 2026, month: 4, day: 3, hour: 9, minute: 0 }, MELBOURNE);
    const fire = nextFireAfter({ cadence: "daily", time: "08:00" }, saturday, MELBOURNE);
    expect(readsAs(fire as number, MELBOURNE)).toBe("2026-04-04 08:00");
  });

  it("weekly fires on the day it was told", () => {
    const from = Date.parse("2026-04-01T00:00:00Z");
    const fire = nextFireAfter(
      { cadence: "weekly", time: "09:30", weekday: "thu" },
      from,
      MELBOURNE,
    );
    expect(readsAs(fire as number, MELBOURNE)).toBe("2026-04-02 09:30");
  });

  it("weekly defaults to Monday when nobody said which day", () => {
    const from = Date.parse("2026-04-01T00:00:00Z");
    const fire = nextFireAfter({ cadence: "weekly", time: "09:00" }, from, MELBOURNE);
    expect(readsAs(fire as number, MELBOURNE)).toBe("2026-04-06 09:00");
  });

  it("monthly fires on its day, in every month", () => {
    let cursor = Date.parse("2026-01-05T00:00:00Z");
    const days: number[] = [];

    for (let i = 0; i < 3; i++) {
      const fire = nextFireAfter({ cadence: "monthly", time: "09:30", day: 1 }, cursor, MELBOURNE);
      if (fire === undefined) break;
      days.push(wallClockAt(fire, MELBOURNE).day);
      cursor = fire;
    }

    expect(days).toEqual([1, 1, 1]);
  });

  it("says nothing for a cron cadence, which it does not do", () => {
    // Honest rather than wrong: a cadence this cannot compute has no next time.
    expect(
      nextFireAfter({ cadence: "cron", time: "08:00" }, Date.now(), MELBOURNE),
    ).toBeUndefined();
  });
});

describe("what was missed", () => {
  const schedule = { cadence: "weekdays" as const, time: "08:00" };

  it("lists the fires between two instants, oldest first", () => {
    const from = instantOf({ year: 2026, month: 4, day: 6, hour: 0, minute: 0 }, MELBOURNE);
    const to = instantOf({ year: 2026, month: 4, day: 9, hour: 0, minute: 0 }, MELBOURNE);

    const fires = firesBetween(schedule, from, to, MELBOURNE).map((f) => readsAs(f, MELBOURNE));
    expect(fires).toEqual(["2026-04-06 08:00", "2026-04-07 08:00", "2026-04-08 08:00"]);
  });

  it("is empty when nothing was missed", () => {
    const from = Date.parse("2026-04-06T00:00:00Z");
    expect(firesBetween(schedule, from, from + 60_000, MELBOURNE)).toEqual([]);
  });

  it("stops at the cap rather than returning a year of them", () => {
    const from = Date.parse("2025-01-01T00:00:00Z");
    const to = Date.parse("2026-01-01T00:00:00Z");
    expect(firesBetween(schedule, from, to, MELBOURNE, 5)).toHaveLength(5);
  });
});

describe("a timezone the machine does not know", () => {
  it("says so rather than pretending", () => {
    expect(isKnownZone(MELBOURNE)).toBe(true);
    expect(isKnownZone("Mars/Olympus_Mons")).toBe(false);
  });
});
