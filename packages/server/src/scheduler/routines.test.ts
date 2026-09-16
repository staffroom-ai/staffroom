/**
 * The routines file, and the scheduler that reads it.
 *
 * Two things are being protected. The file is the owner's, so a routine paused
 * from the browser must not cost them the comments they wrote around it. And
 * nothing unattended may fire twice: a summary written twice is untidy, an email
 * sent twice is a phone call from a customer.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";
import {
  idFromLabel,
  loadRoutines,
  type Routine,
  RoutineSchema,
  removeRoutine,
  saveRoutines,
  upsertRoutine,
} from "./routines.js";
import { readSchedulerState, Scheduler } from "./scheduler.js";
import { instantOf } from "./time.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
const schedulers: Scheduler[] = [];

afterEach(async () => {
  for (const s of schedulers.splice(0)) {
    s.stop();
    await s.drain();
  }
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function officeDir(routinesYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-routines-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  if (routinesYaml !== undefined) {
    writeFileSync(join(dir, "routines.yaml"), routinesYaml, "utf8");
  }
  return dir;
}

async function office(dir: string): Promise<StaffroomServer> {
  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return server;
}

const YAML = `# office/routines.yaml
#
# My own note about why this exists.
version: 1
routines:
  - id: morning-summary
    label: Morning inbox summary      # the one I actually read
    agent: researcher
    task: Summarise anything new in the inbox.
    cadence: weekdays
    time: "08:00"
`;

function routine(overrides: Partial<Routine> = {}): Routine {
  return RoutineSchema.parse({
    id: "morning-summary",
    label: "Morning inbox summary",
    agent: "researcher",
    task: "Summarise anything new in the inbox.",
    cadence: "weekdays",
    time: "08:00",
    ...overrides,
  });
}

describe("reading the file", () => {
  it("reads a routine and fills in the defaults", () => {
    const loaded = loadRoutines(officeDir(YAML));

    expect(loaded.routines).toHaveLength(1);
    expect(loaded.routines[0]?.id).toBe("morning-summary");
    // Asking before anything leaves the machine is the default, on purpose: a
    // routine runs while nobody is watching.
    expect(loaded.routines[0]?.approval_before_send).toBe(true);
    expect(loaded.routines[0]?.catch_up).toBe("latest");
    expect(loaded.routines[0]?.paused).toBe(false);
  });

  it("is empty for an office with no routines at all", () => {
    expect(loadRoutines(officeDir()).routines).toEqual([]);
  });

  it("keeps the good rows when one will not parse", () => {
    const loaded = loadRoutines(
      officeDir(`version: 1
routines:
  - id: broken
    label: Broken
    agent: researcher
    task: Do the thing.
    cadence: fortnightly
    time: "08:00"
  - id: fine
    label: Fine
    agent: researcher
    task: Do the other thing.
    cadence: daily
    time: "09:00"
`),
    );

    // An office that refuses to open over a mistyped cadence is an office
    // nobody leaves running.
    expect(loaded.routines.map((r) => r.id)).toEqual(["fine"]);
    expect(loaded.problems[0]?.id).toBe("broken");
    expect(loaded.problems[0]?.message).toContain("cadence");
  });

  it("reports a file that will not parse at all, rather than throwing", () => {
    const loaded = loadRoutines(officeDir("routines: [\n  - id: {{{\n"));

    expect(loaded.routines).toEqual([]);
    expect(loaded.problems).toHaveLength(1);
  });

  it("uses the first of two routines sharing an id, and says so", () => {
    const loaded = loadRoutines(
      officeDir(`version: 1
routines:
  - id: twice
    label: First
    agent: researcher
    task: Do the thing.
    cadence: daily
    time: "08:00"
  - id: twice
    label: Second
    agent: researcher
    task: Do something else.
    cadence: daily
    time: "09:00"
`),
    );

    // "Run now" has to mean one thing.
    expect(loaded.routines).toHaveLength(1);
    expect(loaded.routines[0]?.label).toBe("First");
    expect(loaded.problems[0]?.message).toContain("more than one");
  });
});

describe("writing it back", () => {
  it("keeps the owner's comments", () => {
    const dir = officeDir(YAML);
    const loaded = loadRoutines(dir);

    saveRoutines(dir, [{ ...(loaded.routines[0] as Routine), paused: true }]);
    const after = readFileSync(join(dir, "routines.yaml"), "utf8");

    expect(after).toContain("My own note about why this exists");
    expect(after).toContain("the one I actually read");
    expect(loadRoutines(dir).routines[0]?.paused).toBe(true);
  });

  it("makes the file when there is not one yet", () => {
    const dir = officeDir();
    saveRoutines(dir, [routine()]);

    expect(loadRoutines(dir).routines).toHaveLength(1);
    expect(readFileSync(join(dir, "routines.yaml"), "utf8")).toContain("your own clock");
  });
});

describe("changing the list", () => {
  it("replaces one in place rather than appending a second", () => {
    const list = [routine(), routine({ id: "other" })];
    const after = upsertRoutine(list, routine({ label: "Renamed" }));

    expect(after).toHaveLength(2);
    expect(after[0]?.label).toBe("Renamed");
    // Order is what the owner sees in their file; a rename must not reshuffle it.
    expect(after[1]?.id).toBe("other");
  });

  it("adds an unknown one at the end", () => {
    expect(upsertRoutine([routine()], routine({ id: "new" })).map((r) => r.id)).toEqual([
      "morning-summary",
      "new",
    ]);
  });

  it("removes by id", () => {
    expect(removeRoutine([routine()], "morning-summary")).toEqual([]);
    expect(removeRoutine([routine()], "nope")).toHaveLength(1);
  });
});

describe("naming a routine from what the owner typed", () => {
  it("makes an id out of a label", () => {
    expect(idFromLabel("Morning inbox summary")).toBe("morning-inbox-summary");
  });

  it("makes one that is usable out of one that is not", () => {
    // Ids have to start with a letter and hold nothing but letters, digits and
    // dashes; nobody typing a sentence should have to know that.
    expect(idFromLabel("  2026 Q1 — review!  ")).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(idFromLabel("!!!")).toBe("routine");
  });

  it("does not collide with one that is already there", () => {
    const taken = new Set(["morning-inbox-summary"]);
    expect(idFromLabel("Morning inbox summary", taken)).toBe("morning-inbox-summary-2");
  });
});

describe("the scheduler", () => {
  /** A clock the test moves by hand, so nothing waits thirty seconds. */
  function clock(start: number): { now: () => number; advance: (ms: number) => void } {
    let at = start;
    return {
      now: () => at,
      advance: (ms: number) => {
        at += ms;
      },
    };
  }

  const MELBOURNE = "Australia/Melbourne";
  const mondayMorning = instantOf({ year: 2026, month: 4, day: 6, hour: 9 }, MELBOURNE);

  async function scheduler(
    dir: string,
    now: () => number,
    notices: string[] = [],
  ): Promise<Scheduler> {
    const server = await office(dir);
    const made = new Scheduler({
      officeDir: dir,
      office: server.office,
      now,
      onNotice: (message) => notices.push(message),
    });
    schedulers.push(made);
    return made;
  }

  it("says when each routine is next due, on the office's own clock", async () => {
    const dir = officeDir(YAML);
    const time = clock(mondayMorning);
    const made = await scheduler(dir, time.now);

    const [status] = made.status();
    expect(status?.routine.id).toBe("morning-summary");
    // Monday 09:00, so the next weekday 08:00 is Tuesday.
    expect(new Date(status?.nextRunAt as number).toISOString()).toBe("2026-04-06T22:00:00.000Z");
  });

  it("has no next time for a paused routine, rather than one that will not happen", async () => {
    const dir = officeDir(YAML.replace('time: "08:00"', 'time: "08:00"\n    paused: true'));
    const made = await scheduler(dir, clock(mondayMorning).now);

    expect(made.status()[0]?.nextRunAt).toBeUndefined();
  });

  it("remembers what it has considered, so nothing fires twice", async () => {
    const dir = officeDir(YAML);
    const time = clock(mondayMorning);
    const made = await scheduler(dir, time.now);

    // Tuesday morning: one fire is due.
    time.advance(24 * 60 * 60 * 1000);
    await made.tick();
    const first = readSchedulerState(dir).lastRunAt["morning-summary"];

    // The very next tick, with no time passing, must find nothing.
    await made.tick();
    expect(readSchedulerState(dir).lastRunAt["morning-summary"]).toBe(first);
  });

  it("writes the mark before the work, so a crash loses a run rather than repeating it", async () => {
    const dir = officeDir(YAML);
    const time = clock(mondayMorning);
    const made = await scheduler(dir, time.now);

    time.advance(24 * 60 * 60 * 1000);
    await made.tick();

    // The mark is on disk whatever happened to the run itself.
    expect(readSchedulerState(dir).lastRunAt["morning-summary"]).toBeGreaterThan(0);
  });

  it("says so when the machine was asleep", async () => {
    const dir = officeDir(YAML);
    const time = clock(mondayMorning);
    const notices: string[] = [];
    const made = await scheduler(dir, time.now, notices);

    // The lid was down for three days; timers do not fire while it is.
    time.advance(3 * 24 * 60 * 60 * 1000);
    await made.tick();

    expect(notices.some((n) => n.includes("was not running"))).toBe(true);
  });

  it("refuses to run a routine naming somebody who is not here, and says why", async () => {
    const dir = officeDir(YAML.replace("agent: researcher", "agent: nobody-by-that-name"));
    const notices: string[] = [];
    const made = await scheduler(dir, clock(mondayMorning).now, notices);

    await made.runNow("morning-summary");
    await made.drain();

    expect(notices.some((n) => n.includes("nobody-by-that-name"))).toBe(true);
  });

  it("reports a routine it could not load, rather than dropping it in silence", async () => {
    const notices: string[] = [];
    const dir = officeDir(YAML.replace("cadence: weekdays", "cadence: fortnightly"));
    await scheduler(dir, clock(mondayMorning).now, notices);

    expect(notices.some((n) => n.includes("was not loaded"))).toBe(true);
  });

  it("does nothing for an id that is not a routine", async () => {
    const made = await scheduler(officeDir(YAML), clock(mondayMorning).now);
    expect(await made.runNow("not-a-routine")).toBe(false);
  });

  it("stops meaning stops: a tick after stop does nothing", async () => {
    const dir = officeDir(YAML);
    const time = clock(mondayMorning);
    const made = await scheduler(dir, time.now);

    made.stop();
    time.advance(24 * 60 * 60 * 1000);
    await made.tick();

    expect(readSchedulerState(dir).lastRunAt["morning-summary"]).toBeUndefined();
  });
});

describe("a cadence that is in the schema but not implemented", () => {
  it("loads, and says out loud that it will never fire", () => {
    const loaded = loadRoutines(
      officeDir(`version: 1
routines:
  - id: cron-one
    label: Every other Tuesday
    agent: researcher
    task: Do the thing.
    cadence: cron
    cron: "0 8 * * 2"
    time: "08:00"
`),
    );

    // Kept, so a file that already says cron does not stop loading — and
    // reported, so it does not sit in the list looking scheduled forever.
    expect(loaded.routines).toHaveLength(1);
    expect(loaded.problems[0]?.message).toContain("not supported yet");
  });
});

describe("an id made from a long sentence", () => {
  it("does not end in a dash", () => {
    // Cutting a label to length lands on a dash about as often as not, and
    // `a-long-label-` is a scruffy thing to leave in somebody's file.
    const id = idFromLabel("Summarise anything new in the inbox and file it as a note.");

    expect(id.endsWith("-")).toBe(false);
    expect(id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
  });

  it("is still a usable id for a label that is all punctuation once trimmed", () => {
    expect(idFromLabel("--- !!! ---")).toBe("routine");
  });
});
