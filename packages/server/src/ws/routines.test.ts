/**
 * Changing routines from the office.
 *
 * The thing worth protecting is that a routine which cannot work is refused
 * while somebody is looking at the screen. A routine naming an agent who is not
 * here would fail at eight every morning in silence, and silence is the failure
 * mode this whole feature has to avoid.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";
import { loadRoutines, type RoutineInput } from "../scheduler/routines.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { handle } from "./handlers.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{
  server: StaffroomServer;
  dir: string;
  scheduler: Scheduler;
}> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-routine-ws-"));
  dirs.push(dir);
  copyTemplate("studio", dir);

  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);

  return { server, dir, scheduler: new Scheduler({ officeDir: dir, office: server.office }) };
}

const ROUTINE = {
  id: "morning-summary",
  label: "Morning inbox summary",
  agent: "researcher",
  task: "Summarise anything new in the inbox.",
  cadence: "weekdays" as const,
  time: "08:00",
};

describe("routine.upsert", () => {
  it("writes it to the owner's file", async () => {
    const { server, dir, scheduler } = await office();

    const result = await handle(
      server.office,
      { type: "routine.upsert", reqId: "r1", routine: ROUTINE },
      { scheduler },
    );

    expect(result.ok).toBe(true);
    expect(loadRoutines(dir).routines[0]?.id).toBe("morning-summary");
    expect(readFileSync(join(dir, "routines.yaml"), "utf8")).toContain("Morning inbox summary");
  });

  it("refuses one naming somebody who is not in this office", async () => {
    const { server, dir, scheduler } = await office();

    const result = await handle(
      server.office,
      { type: "routine.upsert", reqId: "r1", routine: { ...ROUTINE, agent: "nobody" } },
      { scheduler },
    );

    // Refused now, while somebody is looking, rather than failing at eight every
    // morning with nobody there to see it.
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("nobody");
    expect(loadRoutines(dir).routines).toEqual([]);
  });

  it("says what is wrong with one that will not parse", async () => {
    const { server, scheduler } = await office();

    const result = await handle(
      server.office,
      {
        type: "routine.upsert",
        reqId: "r1",
        // Cast because the type forbids it and a browser can send it anyway:
        // what is under test is the runtime check, not the compiler.
        routine: { ...ROUTINE, cadence: "fortnightly" } as never,
      },
      { scheduler },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("cadence");
  });

  it("replaces one with the same id rather than making a second", async () => {
    const { server, dir, scheduler } = await office();
    const send = (routine: RoutineInput) =>
      handle(server.office, { type: "routine.upsert", reqId: "r", routine }, { scheduler });

    await send(ROUTINE);
    await send({ ...ROUTINE, label: "Renamed" });

    const loaded = loadRoutines(dir).routines;
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.label).toBe("Renamed");
  });

  it("says so when the office is not running routines at all", async () => {
    const { server } = await office();

    const result = await handle(server.office, {
      type: "routine.upsert",
      reqId: "r1",
      routine: ROUTINE,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.hint).toContain("--no-watch");
  });
});

describe("routine.delete", () => {
  it("removes it from the file", async () => {
    const { server, dir, scheduler } = await office();
    await handle(
      server.office,
      { type: "routine.upsert", reqId: "r1", routine: ROUTINE },
      { scheduler },
    );

    const result = await handle(
      server.office,
      { type: "routine.delete", reqId: "r2", routineId: "morning-summary" },
      { scheduler },
    );

    expect(result.ok).toBe(true);
    expect(loadRoutines(dir).routines).toEqual([]);
  });

  it("refuses an id that is not there, rather than answering ok", async () => {
    const { server, scheduler } = await office();

    const result = await handle(
      server.office,
      { type: "routine.delete", reqId: "r1", routineId: "not-a-routine" },
      { scheduler },
    );

    expect(result.ok).toBe(false);
  });
});

describe("routine.run_now", () => {
  it("accepts a routine that exists", async () => {
    const { server, scheduler } = await office();
    await handle(
      server.office,
      { type: "routine.upsert", reqId: "r1", routine: ROUTINE },
      { scheduler },
    );

    const result = await handle(
      server.office,
      { type: "routine.run_now", reqId: "r2", routineId: "morning-summary" },
      { scheduler },
    );

    // Answered at once rather than awaited: a routine can take minutes, and the
    // owner pressed a button rather than asking to wait.
    expect(result.ok).toBe(true);
    scheduler.stop();
    await scheduler.drain();
  }, 20_000);

  it("refuses one that does not exist", async () => {
    const { server, scheduler } = await office();

    const result = await handle(
      server.office,
      { type: "routine.run_now", reqId: "r1", routineId: "nope" },
      { scheduler },
    );

    expect(result.ok).toBe(false);
  });
});

describe("a task with a schedule", () => {
  it("becomes a routine rather than running now", async () => {
    const { server, dir, scheduler } = await office();

    const result = await handle(
      server.office,
      {
        type: "task.create",
        reqId: "r1",
        department: "marketing",
        text: "Summarise anything new in the inbox.",
        schedule: { cadence: "weekdays", time: "08:00", label: "Morning inbox summary" },
      },
      { scheduler },
    );

    expect(result.ok).toBe(true);
    expect((result.result as { scheduled: boolean }).scheduled).toBe(true);

    const written = loadRoutines(dir).routines[0];
    expect(written?.label).toBe("Morning inbox summary");
    expect(written?.task).toBe("Summarise anything new in the inbox.");
    expect(written?.cadence).toBe("weekdays");
  });

  it("names it after the task when nobody gave it a label", async () => {
    const { server, dir, scheduler } = await office();

    await handle(
      server.office,
      {
        type: "task.create",
        reqId: "r1",
        department: "marketing",
        text: "Check the inbox and tell me what changed.",
        schedule: { cadence: "daily", time: "09:00" },
      },
      { scheduler },
    );

    // Nobody typing "every morning at nine" should have to think of a name too.
    const written = loadRoutines(dir).routines[0];
    expect(written?.label).toBe("Check the inbox and tell me what changed.");
    expect(written?.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("gives it to the department's lead when no agent was named", async () => {
    const { server, dir, scheduler } = await office();

    await handle(
      server.office,
      {
        type: "task.create",
        reqId: "r1",
        department: "marketing",
        text: "Summarise the week.",
        schedule: { cadence: "weekly", time: "17:00", weekday: "fri" },
      },
      { scheduler },
    );

    // A routine skips routing, so somebody has to be named; the lead is who the
    // task bar would have handed it to.
    expect(loadRoutines(dir).routines[0]?.agent).toBe(
      server.office.roster.leadFor("marketing")?.id,
    );
  });

  it("does not collide with a routine that is already there", async () => {
    const { server, dir, scheduler } = await office();
    const send = () =>
      handle(
        server.office,
        {
          type: "task.create",
          reqId: "r",
          department: "marketing",
          text: "Summarise the week.",
          schedule: { cadence: "daily", time: "09:00" },
        },
        { scheduler },
      );

    await send();
    await send();

    const ids = loadRoutines(dir).routines.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });
});
