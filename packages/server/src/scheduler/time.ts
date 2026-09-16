/**
 * "Every weekday at 08:00" in the owner's own timezone.
 *
 * The whole problem is one sentence: 08:00 in Melbourne is a different UTC
 * instant in March than it is in July, and a routine that drifts by an hour twice
 * a year is a routine nobody trusts. So nothing here works in UTC and adds an
 * offset. Every fire time is decided as a wall clock in the office's timezone and
 * then converted, which is the only way round that is correct on both sides of a
 * daylight-saving change.
 *
 * The spec says Temporal. Node has no Temporal and the polyfill is a large
 * dependency for what is, underneath, one question — "what instant is this wall
 * clock in this zone?" — that `Intl` already answers. So it is answered here, in
 * about forty lines, with the two awkward days of the year tested directly.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 is Sunday, matching Date.getDay. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** A formatter per zone: building one is expensive and they are reused constantly. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing !== undefined) return existing;

  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  formatters.set(timeZone, made);
  return made;
}

/** True when a zone name is one this machine's Intl actually knows. */
export function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** What the clock on the wall says in that zone, at that instant. */
export function wallClockAt(instant: number, timeZone: string): WallClock {
  // Named rather than left to Intl, which throws "Invalid time value" from four
  // frames down and says nothing about what produced the number.
  if (!Number.isFinite(instant)) {
    throw new RangeError(`${instant} is not an instant; a fire time was computed wrongly.`);
  }
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "0";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // 24-hour formatting renders midnight as "24" in some engines.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * The UTC instant at which that zone's clock reads this.
 *
 * Guess the instant as though the zone were UTC, ask what the clock actually
 * says there, and correct by the difference. Twice, because the first correction
 * can cross a daylight-saving boundary and land in a different offset than it
 * started in — which is exactly what happens on the two days a year this has to
 * get right.
 */
export function instantOf(
  wall: { year: number; month: number; day: number; hour: number; minute?: number },
  timeZone: string,
): number {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute ?? 0);
  let guess = target;

  for (let attempt = 0; attempt < 2; attempt++) {
    const there = wallClockAt(guess, timeZone);
    const asUtc = Date.UTC(there.year, there.month - 1, there.day, there.hour, there.minute);
    const drift = asUtc - target;
    if (drift === 0) return guess;
    guess -= drift;
  }

  return guess;
}

export type Cadence = "daily" | "weekdays" | "weekly" | "monthly" | "cron";

export interface Schedule {
  cadence: Cadence;
  /** "HH:MM" on the office's own clock. */
  time: string;
  weekday?: string | undefined;
  /** 1 to 28: the 29th onward does not exist in every month. */
  day?: number | undefined;
}

const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseTime(time: string): { hour: number; minute: number } {
  const [hour = "0", minute = "0"] = time.split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

/** Does this wall-clock day match the cadence? */
function dayMatches(schedule: Schedule, wall: WallClock): boolean {
  switch (schedule.cadence) {
    case "daily":
      return true;
    case "weekdays":
      // Monday to Friday. The owner's working week, not a calendar convention.
      return wall.weekday >= 1 && wall.weekday <= 5;
    case "weekly": {
      const wanted = WEEKDAY_NAMES.indexOf(schedule.weekday ?? "mon");
      return wall.weekday === (wanted === -1 ? 1 : wanted);
    }
    case "monthly":
      return wall.day === (schedule.day ?? 1);
    default:
      return false;
  }
}

/** How far ahead to look before giving up. Two years covers every cadence here. */
const HORIZON_DAYS = 800;

/**
 * The first time this routine fires strictly after `after`.
 *
 * Walks forward a day at a time on the office's own calendar rather than adding
 * 24-hour blocks: the day after a daylight-saving change is 23 or 25 hours long,
 * and adding a day in milliseconds would put a "daily at 08:00" routine at 07:00
 * for half the year.
 */
export function nextFireAfter(
  schedule: Schedule,
  after: number,
  timeZone: string,
): number | undefined {
  if (schedule.cadence === "cron") return undefined;

  const { hour, minute } = parseTime(schedule.time);
  const start = wallClockAt(after, timeZone);

  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    // Stepping the calendar date through UTC arithmetic is safe: only the
    // year-month-day is carried over, and the instant is computed from the zone.
    const stepped = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, 12));
    const candidate = {
      year: stepped.getUTCFullYear(),
      month: stepped.getUTCMonth() + 1,
      day: stepped.getUTCDate(),
      hour,
      minute,
    };

    const instant = instantOf(candidate, timeZone);
    const there = wallClockAt(instant, timeZone);

    // The day in the office's own calendar, which is what the cadence is about.
    if (!dayMatches(schedule, there)) continue;
    if (instant > after) return instant;
  }

  return undefined;
}

/**
 * Every fire between two instants, oldest first.
 *
 * Used by catch-up, which needs to know what was missed rather than only when
 * the next one is. Capped, because a routine that has not run for a year should
 * not produce three hundred entries for somebody to decide about.
 */
export function firesBetween(
  schedule: Schedule,
  from: number,
  to: number,
  timeZone: string,
  limit = 64,
): number[] {
  const fires: number[] = [];
  let cursor = from;

  while (fires.length < limit) {
    const next = nextFireAfter(schedule, cursor, timeZone);
    if (next === undefined || next > to) break;
    fires.push(next);
    cursor = next;
  }

  return fires;
}
