/**
 * Hiring, editing and letting go from Settings.
 *
 * The thing these exist to prove is not that a file changed — the writer's own
 * tests cover that — but that the running office changed with it. Before this,
 * adding somebody to agents.yaml wrote the file and left the office with the
 * staff it booted with, and nothing said so: the roster panel and the room both
 * carried on as though nothing had happened. A hire you cannot see is a hire
 * that did not work.
 *
 * So every test here asks the office, not the file.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";
import { handle } from "./handlers.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{ server: StaffroomServer; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-roster-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);
  return { server, dir };
}

const NEW_HIRE = {
  id: "support-lead",
  department: "marketing",
  role: "Support lead",
  does: "Answers questions from customers about their orders.",
};

describe("hiring from Settings", () => {
  it("puts them in the running office, not only in the file", async () => {
    const { server, dir } = await office();

    const result = await handle(server.office, {
      type: "agent.create",
      reqId: "r1",
      agent: NEW_HIRE,
    });

    expect(result.ok).toBe(true);
    // The office, not readFileSync: this is the half that used to be missing.
    expect(server.office.roster.agent("support-lead")?.role).toBe("Support lead");
    expect(server.office.agentsFile.agents.map((a) => a.id)).toContain("support-lead");
    expect(readFileSync(join(dir, "agents.yaml"), "utf8")).toContain("support-lead");
  });

  it("gives them a desk, so the room has somewhere to draw them", async () => {
    const { server } = await office();
    await handle(server.office, { type: "agent.create", reqId: "r1", agent: NEW_HIRE });

    const seat = server.office.roster.seatOf("support-lead");
    expect(seat?.department).toBe("marketing");
    expect(typeof seat?.seat).toBe("number");
  });

  it("refuses a taken id in words the person can act on", async () => {
    // These are forms. "There is already somebody with the id bookkeeper" is
    // something you can do something about; "could not write agents.yaml" is not.
    const { server } = await office();
    const result = await handle(server.office, {
      type: "agent.create",
      reqId: "r1",
      agent: { ...NEW_HIRE, id: "bookkeeper" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("already somebody with the id bookkeeper");
  });

  it("keeps the owner's comments in their file", async () => {
    const { server, dir } = await office();
    await handle(server.office, { type: "agent.create", reqId: "r1", agent: NEW_HIRE });

    const yaml = readFileSync(join(dir, "agents.yaml"), "utf8");
    expect(yaml).toContain("# office/agents.yaml");
  });
});

describe("editing and letting go", () => {
  it("changes a role in the running office", async () => {
    const { server } = await office();
    const result = await handle(server.office, {
      type: "agent.update",
      reqId: "r1",
      agentId: "copywriter",
      fields: { role: "Senior copywriter" },
    });

    expect(result.ok).toBe(true);
    expect(server.office.roster.agent("copywriter")?.role).toBe("Senior copywriter");
  });

  it("leaves untouched fields alone", async () => {
    const { server } = await office();
    const before = server.office.roster.agent("copywriter")?.does;

    await handle(server.office, {
      type: "agent.update",
      reqId: "r1",
      agentId: "copywriter",
      fields: { role: "Senior copywriter" },
    });

    expect(server.office.roster.agent("copywriter")?.does).toBe(before);
  });

  it("removes somebody from the office as well as the file", async () => {
    const { server } = await office();
    const result = await handle(server.office, {
      type: "agent.remove",
      reqId: "r1",
      agentId: "copywriter",
    });

    expect(result.ok).toBe(true);
    expect(server.office.roster.agent("copywriter")).toBeUndefined();
    expect(server.office.roster.seatOf("copywriter")).toBeUndefined();
  });

  it("reseats the people who are left", async () => {
    // Desks are worked out from the file's order, so a leaver moves everybody
    // behind them. A stale seat is somebody drawn standing inside a desk.
    const { server } = await office();
    const marketing = () =>
      server.office.roster.departments.find((d) => d.id === "marketing")?.agents.map((a) => a.id);
    const before = marketing() ?? [];
    expect(before.length).toBeGreaterThan(1);

    await handle(server.office, {
      type: "agent.remove",
      reqId: "r1",
      agentId: before[0] as string,
    });

    expect(marketing()).not.toContain(before[0]);
    expect(server.office.roster.seatOf(before[1] as string)?.seat).toBe(0);
  });
});

describe("departments", () => {
  it("opens one and hires into it in two steps", async () => {
    /*
     * The order the form works in, and the one that caught a real bug: a
     * department added a moment ago was invisible to the check that the hire's
     * department exists, so the second step was refused for a department the
     * first step had just opened.
     */
    const { server } = await office();

    const opened = await handle(server.office, {
      type: "department.create",
      reqId: "r1",
      id: "support",
      label: "Support",
    });
    expect(opened.ok).toBe(true);

    const hired = await handle(server.office, {
      type: "agent.create",
      reqId: "r2",
      agent: { ...NEW_HIRE, id: "helper", department: "support" },
    });

    expect(hired.ok).toBe(true);
    expect(server.office.roster.department("support")?.label).toBe("Support");
  });

  it("refuses to close one that still has people in it, and says who", async () => {
    const { server } = await office();
    const result = await handle(server.office, {
      type: "department.remove",
      reqId: "r1",
      id: "marketing",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Move them first");
  });

  it("renames one without moving anybody", async () => {
    const { server } = await office();
    const result = await handle(server.office, {
      type: "department.rename",
      reqId: "r1",
      id: "marketing",
      label: "Marketing and brand",
    });

    expect(result.ok).toBe(true);
    expect(server.office.roster.department("marketing")?.label).toBe("Marketing and brand");
    expect(server.office.roster.agent("copywriter")?.department).toBe("marketing");
  });
});
