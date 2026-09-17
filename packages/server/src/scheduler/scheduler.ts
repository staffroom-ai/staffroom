/**
 * The thing that actually fires the routines.
 *
 * It ticks every thirty seconds, which is coarse on purpose: a routine is "the
 * morning summary", not a cron job, and a tick a second would be thirty times
 * the wakeups for no difference anybody could name.
 *
 * Three rules it is built on:
 *
 *   Routines run one at a time. Two agents writing to the brain at eight in the
 *   morning is a race the owner did not ask for; a task they type themselves is
 *   never blocked behind one.
 *
 *   The mark moves before the work starts, not after it finishes. A crash
 *   mid-run therefore loses that run rather than repeating it — and for a
 *   routine that emails a customer, twice is the worse failure.
 *
 *   Waking from sleep is not the same as time passing. A laptop shut on Monday
 *   and opened on Thursday has a ninety-second gap between ticks that should
 *   have been thirty, and that gap is the signal to work out what was missed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Office } from "@staffroom/core";
import { planCatchUp, runLabel } from "./catchup.js";
import { loadRoutines, type Routine, saveRoutines } from "./routines.js";
import { isKnownZone, nextFireAfter } from "./time.js";

export const TICK_MS = 30_000;

/**
 * A gap this much longer than a tick means the machine was asleep.
 *
 * Timers do not fire while a laptop is shut, so the first tick after waking is
 * late by however long the lid was down. Noticing that is what turns "the office
 * was off" into "here is what you missed".
 */
export const SLEEP_GAP_MS = 90_000;

/** What the owner said when asked about the template's own notes and runs. */
export type SampleAnswer = "removed" | "kept";

export interface SchedulerState {
  /** Per routine id, when it was last considered. */
  lastRunAt: Record<string, number>;
  /**
   * What the owner said to the sample-content question, if they have been asked.
   *
   * It lives here rather than in a file of its own because this is already the
   * office's note-to-self about things it has done: not configuration, nothing
   * to edit, and safe to delete at the cost of being asked once more. Absent
   * means the question is still open.
   */
  sampleContent?: SampleAnswer;
}

export function schedulerStatePath(officeDir: string): string {
  return join(officeDir, ".staffroom", "scheduler.json");
}

export function readSchedulerState(officeDir: string): SchedulerState {
  const path = schedulerStatePath(officeDir);
  if (!existsSync(path)) return { lastRunAt: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SchedulerState;
    // Listed field by field rather than spread, so a stray key somebody typed
    // in cannot become state the office starts believing.
    return {
      lastRunAt: parsed?.lastRunAt ?? {},
      ...(parsed?.sampleContent === "removed" || parsed?.sampleContent === "kept"
        ? { sampleContent: parsed.sampleContent }
        : {}),
    };
  } catch {
    // A corrupt mark means the office does not know what it missed. Treating
    // that as "nothing" is the safe answer: better a skipped summary than a
    // week of them arriving at once.
    return { lastRunAt: {} };
  }
}

export function writeSchedulerState(officeDir: string, state: SchedulerState): void {
  const path = schedulerStatePath(officeDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

/** The recorded answer, or undefined while the question is still open. */
export function readSampleAnswer(officeDir: string): SampleAnswer | undefined {
  return readSchedulerState(officeDir).sampleContent;
}

/**
 * Writes the answer down, keeping everything else in the file.
 *
 * Read-modify-write rather than a fresh object: the routine marks in here are
 * what stop a week of missed summaries arriving at once, and losing them to
 * record a yes or no would be a bad trade for a question about sample text.
 */
export function recordSampleAnswer(officeDir: string, answer: SampleAnswer): void {
  const state = readSchedulerState(officeDir);
  state.sampleContent = answer;
  writeSchedulerState(officeDir, state);
}

export interface SchedulerOptions {
  officeDir: string;
  office: Office;
  /** Overridable for tests, which must not wait thirty seconds. */
  tickMs?: number;
  now?: () => number;
  /** Told about anything the owner should know, for the Activity feed. */
  onNotice?: (message: string) => void;
}

export interface RoutineStatus {
  routine: Routine;
  nextRunAt: number | undefined;
}

export class Scheduler {
  private readonly options: SchedulerOptions;
  private timer: NodeJS.Timeout | undefined;
  private state: SchedulerState;
  private routines: Routine[] = [];
  /** One at a time: the promise the current routine run is waiting on. */
  private running: Promise<void> = Promise.resolve();
  private lastTickAt: number;
  private stopped = false;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.state = readSchedulerState(options.officeDir);
    this.lastTickAt = this.now();
    this.reload();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /**
   * The office's own timezone, which is what every fire time is computed in.
   *
   * A zone this machine's Intl does not know would silently become UTC, which is
   * a routine firing at the wrong time of day rather than an error anybody sees,
   * so it is said out loud and UTC is used deliberately.
   */
  private timeZone(): string {
    const zone = this.options.office.agentsFile.office.timezone;
    if (isKnownZone(zone)) return zone;
    this.options.onNotice?.(
      `This machine does not know the timezone ${zone}, so routines are being scheduled in UTC. Check agents.yaml.`,
    );
    return "UTC";
  }

  /** Re-reads routines.yaml. Called at start and whenever the file changes. */
  reload(): void {
    const loaded = loadRoutines(this.options.officeDir);
    this.routines = loaded.routines;
    for (const problem of loaded.problems) {
      this.options.onNotice?.(`Routine ${problem.id} was not loaded: ${problem.message}`);
    }
  }

  list(): Routine[] {
    return this.routines.map((r) => ({ ...r }));
  }

  /** Every routine with the next time it is due, for OfficeState. */
  status(): RoutineStatus[] {
    const zone = this.timeZone();
    const now = this.now();

    return this.routines.map((routine) => ({
      routine,
      nextRunAt: routine.paused
        ? undefined
        : nextFireAfter(
            {
              cadence: routine.cadence,
              time: routine.time,
              weekday: routine.weekday,
              day: routine.day,
            },
            now,
            zone,
          ),
    }));
  }

  save(routines: Routine[]): void {
    this.routines = routines;
    saveRoutines(this.options.officeDir, routines);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.stopped = false;
    this.lastTickAt = this.now();

    const timer = setInterval(() => {
      void this.tick();
    }, this.options.tickMs ?? TICK_MS);
    // Never the reason a process stays alive: the office decides that.
    timer.unref?.();
    this.timer = timer;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Waits for whatever is running, so a close does not cut a routine in half. */
  async drain(): Promise<void> {
    await this.running;
  }

  /**
   * One pass over every routine.
   *
   * Exported rather than private so tests can advance a clock and call it,
   * instead of waiting thirty seconds a case.
   */
  async tick(): Promise<void> {
    if (this.stopped) return;

    const now = this.now();
    const gap = now - this.lastTickAt;
    this.lastTickAt = now;

    // The lid was down. Say so, because the catch-up that follows would
    // otherwise look like the office deciding to do several things at once.
    if (gap > SLEEP_GAP_MS) {
      this.options.onNotice?.(
        `The office was not running for ${Math.round(gap / 60_000)} minutes. Checking what your routines missed.`,
      );
    }

    const zone = this.timeZone();

    for (const routine of this.routines) {
      if (this.stopped) return;

      /*
       * A routine seen for the first time gets its mark set to now.
       *
       * Without this, `since` would fall back to `now` on every tick, every
       * window would be empty, and nothing would ever fire — and the first time
       * anybody noticed would be a morning summary that never arrived.
       */
      const known = this.state.lastRunAt[routine.id];
      if (known === undefined) {
        this.state.lastRunAt[routine.id] = now;
        writeSchedulerState(this.options.officeDir, this.state);
        continue;
      }

      const since = known;
      const plan = planCatchUp(routine, since, now, zone);

      if (plan.skipped > 0) {
        this.options.onNotice?.(
          `${routine.label}: ${plan.skipped} missed ${plan.skipped === 1 ? "run" : "runs"} were too old to be worth doing.`,
        );
      }

      // Written before anything starts. A crash now loses this run rather than
      // repeating it, which is the right way round for work that leaves the
      // machine.
      if (plan.lastRunAt !== since) {
        this.state.lastRunAt[routine.id] = plan.lastRunAt;
        writeSchedulerState(this.options.officeDir, this.state);
      }

      for (const _fire of plan.runs) {
        await this.enqueue(routine, plan.catchUp);
      }
    }
  }

  /** Runs it now without touching the schedule, for `routine.run_now`. */
  async runNow(id: string): Promise<boolean> {
    const routine = this.routines.find((r) => r.id === id);
    if (routine === undefined) return false;
    await this.enqueue(routine, false);
    return true;
  }

  /**
   * Puts a run behind whatever else is running.
   *
   * The chain is the serialisation: each run waits on the one before it, and a
   * failure does not break the chain for the next one — a routine that threw on
   * Tuesday must not stop Wednesday's from ever starting.
   */
  private enqueue(routine: Routine, catchUp: boolean): Promise<void> {
    this.running = this.running
      .catch(() => undefined)
      .then(async () => {
        if (this.stopped) return;
        await this.run(routine, catchUp);
      });
    return this.running;
  }

  private async run(routine: Routine, catchUp: boolean): Promise<void> {
    const office = this.options.office;
    const agent = office.roster.agent(routine.agent);

    if (agent === undefined) {
      this.options.onNotice?.(
        `${routine.label} could not run: there is nobody called ${routine.agent} in this office. Check routines.yaml.`,
      );
      return;
    }

    try {
      const submitted = await office.runner.submitTask({
        department: agent.department,
        agentId: agent.id,
        prompt: routine.task,
        source: "routine",
        routineId: routine.id,
        label: runLabel(routine, catchUp),
      });
      await submitted.finished;
    } catch (error) {
      // A routine that fails is a line in the feed, never a stopped office.
      this.options.onNotice?.(
        `${routine.label} did not finish: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
