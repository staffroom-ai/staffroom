/**
 * Saying when, in words rather than in cron.
 *
 * The whole control is four choices and a time, because a person running a
 * business wants "every weekday at eight" and not a five-field expression. Every
 * cadence the office can actually compute is here, and nothing else is offered:
 * a picker that lets somebody choose a schedule the scheduler will not fire is
 * a picker that lies.
 *
 * The wording is the feature. "Now" reads as a verb and the rest read as
 * sentences, so the control says what will happen rather than naming a concept.
 */

export type When = "now" | "daily" | "weekdays" | "weekly" | "monthly";

export interface ScheduleChoice {
  when: When;
  /** "HH:MM" on the office's own clock. */
  time: string;
  weekday: Weekday;
  /** 1 to 28: the 29th onward does not exist in every month. */
  day: number;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: Array<{ id: Weekday; label: string }> = [
  { id: "mon", label: "Monday" },
  { id: "tue", label: "Tuesday" },
  { id: "wed", label: "Wednesday" },
  { id: "thu", label: "Thursday" },
  { id: "fri", label: "Friday" },
  { id: "sat", label: "Saturday" },
  { id: "sun", label: "Sunday" },
];

/** What the picker offers, in the order somebody is likely to want them. */
export const WHEN_OPTIONS: Array<{ id: When; label: string }> = [
  { id: "now", label: "Now" },
  { id: "weekdays", label: "Every weekday at" },
  { id: "daily", label: "Every day at" },
  { id: "weekly", label: "Every week on" },
  { id: "monthly", label: "Every month on the" },
];

/** Nine in the morning: the hour somebody means when they say "every day". */
export const DEFAULT_TIME = "09:00";

export const DEFAULT_CHOICE: ScheduleChoice = {
  when: "now",
  time: DEFAULT_TIME,
  weekday: "mon",
  day: 1,
};

/**
 * What to send with `task.create`, or undefined for "do it now".
 *
 * Undefined rather than a schedule with a flag: "now" is the absence of a
 * schedule, and making it one would mean every reader of this message has to
 * know which flag means "not really".
 */
export function scheduleSpecFor(choice: ScheduleChoice):
  | {
      cadence: "daily" | "weekdays" | "weekly" | "monthly";
      time: string;
      weekday?: Weekday;
      day?: number;
    }
  | undefined {
  if (choice.when === "now") return undefined;

  return {
    cadence: choice.when,
    time: choice.time,
    ...(choice.when === "weekly" ? { weekday: choice.weekday } : {}),
    ...(choice.when === "monthly" ? { day: choice.day } : {}),
  };
}

/** `1st`, `2nd`, `3rd`, `11th`. */
export function ordinal(day: number): string {
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * The whole choice as one sentence.
 *
 * Shown beside the button, so somebody who has changed one dropdown can read
 * back what they actually asked for rather than assembling it from three
 * controls.
 */
export function describeChoice(choice: ScheduleChoice): string {
  switch (choice.when) {
    case "now":
      return "Now";
    case "daily":
      return `Every day at ${choice.time}`;
    case "weekdays":
      return `Every weekday at ${choice.time}`;
    case "weekly": {
      const day = WEEKDAYS.find((d) => d.id === choice.weekday)?.label ?? "Monday";
      return `Every ${day} at ${choice.time}`;
    }
    case "monthly":
      return `Every month on the ${ordinal(choice.day)} at ${choice.time}`;
  }
}

/** What the submit button says, so it is never just "Send" for a schedule. */
export function submitLabel(choice: ScheduleChoice, disabled: boolean): string {
  if (disabled) return "Reconnecting";
  return choice.when === "now" ? "Send" : "Schedule";
}

/**
 * When a routine next runs, in the owner's words.
 *
 * Relative for anything close, because "in 2 hours" is the answer to "is this
 * about to happen?" and a timestamp is not. Absolute after that, because "in 19
 * days" is not an answer to anything.
 */
export function nextRunText(nextRunAt: string | null, now: number = Date.now()): string {
  if (nextRunAt === null) return "Paused";

  const at = Date.parse(nextRunAt);
  if (!Number.isFinite(at)) return "Not scheduled";

  const minutes = Math.round((at - now) / 60_000);
  if (minutes < 0) return "Due now";
  if (minutes < 1) return "In under a minute";
  if (minutes < 60) return `In ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `In ${hours} ${hours === 1 ? "hour" : "hours"}`;

  const date = new Date(at);
  const days = Math.round(hours / 24);
  if (days <= 6) {
    return `${date.toLocaleDateString([], { weekday: "long" })} at ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** "Every weekday at 08:00", from what the office sent back. */
export function describeRoutine(routine: { cadence: string; at: string }): string {
  switch (routine.cadence) {
    case "daily":
      return `Every day at ${routine.at}`;
    case "weekdays":
      return `Every weekday at ${routine.at}`;
    case "weekly":
      return `Every week at ${routine.at}`;
    case "monthly":
      return `Every month at ${routine.at}`;
    case "cron":
      // The office loads these and refuses to fire them; saying "scheduled"
      // would be the interface repeating a promise the scheduler will not keep.
      return "A cron schedule, which this version does not run";
    default:
      return routine.cadence;
  }
}
