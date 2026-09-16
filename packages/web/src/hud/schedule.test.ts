/**
 * Saying when, in words.
 *
 * Two things are being protected. The picker must only offer schedules the
 * office can actually fire — a control that lets somebody choose something the
 * scheduler will refuse is a control that lies. And "now" has to stay the
 * absence of a schedule rather than a schedule with a flag on it, or every
 * reader of that message has to learn which flag means "not really".
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICE,
  describeChoice,
  describeRoutine,
  nextRunText,
  ordinal,
  type ScheduleChoice,
  scheduleSpecFor,
  submitLabel,
  WHEN_OPTIONS,
} from "./schedule.js";

const choice = (overrides: Partial<ScheduleChoice> = {}): ScheduleChoice => ({
  ...DEFAULT_CHOICE,
  ...overrides,
});

describe("what the picker offers", () => {
  it("offers only cadences the office will actually fire", () => {
    // `cron` is in the routine schema and the scheduler refuses it, so it must
    // not be on the menu.
    expect(WHEN_OPTIONS.map((o) => o.id)).toEqual([
      "now",
      "weekdays",
      "daily",
      "weekly",
      "monthly",
    ]);
  });

  it("reads as sentences rather than naming a concept", () => {
    expect(WHEN_OPTIONS.find((o) => o.id === "weekdays")?.label).toBe("Every weekday at");
    expect(WHEN_OPTIONS.find((o) => o.id === "now")?.label).toBe("Now");
  });

  it("starts on Now, so the control does nothing until somebody asks it to", () => {
    expect(DEFAULT_CHOICE.when).toBe("now");
  });
});

describe("what gets sent", () => {
  it("sends nothing at all for Now", () => {
    // The absence of a schedule, not a schedule with a flag.
    expect(scheduleSpecFor(choice({ when: "now" }))).toBeUndefined();
  });

  it("sends the cadence and the time for every weekday", () => {
    expect(scheduleSpecFor(choice({ when: "weekdays", time: "08:00" }))).toEqual({
      cadence: "weekdays",
      time: "08:00",
    });
  });

  it("sends a weekday only when the cadence is weekly", () => {
    expect(scheduleSpecFor(choice({ when: "weekly", weekday: "thu" }))).toMatchObject({
      cadence: "weekly",
      weekday: "thu",
    });
    // A leftover weekday on a daily routine would be a field the office has to
    // decide whether to believe.
    expect(scheduleSpecFor(choice({ when: "daily", weekday: "thu" }))).not.toHaveProperty(
      "weekday",
    );
  });

  it("sends a day of the month only when the cadence is monthly", () => {
    expect(scheduleSpecFor(choice({ when: "monthly", day: 15 }))).toMatchObject({
      cadence: "monthly",
      day: 15,
    });
    expect(scheduleSpecFor(choice({ when: "weekdays", day: 15 }))).not.toHaveProperty("day");
  });
});

describe("reading the choice back", () => {
  it("says the whole thing in one sentence", () => {
    expect(describeChoice(choice({ when: "weekdays", time: "08:00" }))).toBe(
      "Every weekday at 08:00",
    );
    expect(describeChoice(choice({ when: "weekly", weekday: "fri", time: "17:00" }))).toBe(
      "Every Friday at 17:00",
    );
    expect(describeChoice(choice({ when: "monthly", day: 1, time: "09:30" }))).toBe(
      "Every month on the 1st at 09:30",
    );
    expect(describeChoice(choice({ when: "now" }))).toBe("Now");
  });
});

describe("ordinal", () => {
  it("gets the awkward ones right", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
    ]);
  });
});

describe("the button", () => {
  it("says what pressing it will do", () => {
    // Never just "Send" for something that is not going to happen now.
    expect(submitLabel(choice({ when: "now" }), false)).toBe("Send");
    expect(submitLabel(choice({ when: "weekdays" }), false)).toBe("Schedule");
  });

  it("says the office is not there, ahead of either", () => {
    expect(submitLabel(choice({ when: "weekdays" }), true)).toBe("Reconnecting");
  });
});

describe("when a routine next runs", () => {
  const now = Date.parse("2026-04-06T00:00:00Z");
  const inMinutes = (n: number): string => new Date(now + n * 60_000).toISOString();

  it("says paused rather than inventing a time", () => {
    expect(nextRunText(null, now)).toBe("Paused");
  });

  it("counts in minutes for something about to happen", () => {
    expect(nextRunText(inMinutes(1), now)).toBe("In 1 minute");
    expect(nextRunText(inMinutes(45), now)).toBe("In 45 minutes");
  });

  it("counts in hours for the rest of the day", () => {
    expect(nextRunText(inMinutes(120), now)).toBe("In 2 hours");
  });

  it("names the day within the week, because a countdown stops being an answer", () => {
    // "In 53 hours" tells nobody anything; "Wednesday at 08:00" does.
    const text = nextRunText(inMinutes(60 * 50), now);
    expect(text).toMatch(/at/);
    expect(text).not.toMatch(/^In /);
  });

  it("gives a date once it is more than a week out", () => {
    expect(nextRunText(inMinutes(60 * 24 * 20), now)).toMatch(/\d/);
    expect(nextRunText(inMinutes(60 * 24 * 20), now)).not.toMatch(/^In /);
  });

  it("says due now for one that has already passed", () => {
    expect(nextRunText(inMinutes(-5), now)).toBe("Due now");
  });

  it("does not pretend a broken timestamp is a time", () => {
    expect(nextRunText("not a date", now)).toBe("Not scheduled");
  });
});

describe("describing a routine the office sent back", () => {
  it("reads as a sentence", () => {
    expect(describeRoutine({ cadence: "weekdays", at: "08:00" })).toBe("Every weekday at 08:00");
    expect(describeRoutine({ cadence: "monthly", at: "09:30" })).toBe("Every month at 09:30");
  });

  it("says plainly that a cron routine will not run", () => {
    // The office loads these and refuses to fire them. Calling it "scheduled"
    // would be the interface repeating a promise nothing is going to keep.
    expect(describeRoutine({ cadence: "cron", at: "08:00" })).toContain("does not run");
  });
});
