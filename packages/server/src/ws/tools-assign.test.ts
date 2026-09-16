/**
 * Answering "New tool x is ready. Who may use it?"
 *
 * The card asks about a set of people and Save is pressed once, so this is one
 * message about a set, not one per person. Two things matter beyond that: the
 * write must keep the owner's own file intact — their comments and their
 * ordering — and a partly-successful assignment must say which names did not
 * take, because silently doing three of four is how somebody ends up wondering
 * why one of their staff still cannot use a tool.
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
  const dir = mkdtempSync(join(tmpdir(), "staffroom-assign-"));
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

function agentsYaml(dir: string): string {
  return readFileSync(join(dir, "agents.yaml"), "utf8");
}

function commentsIn(yaml: string): string[] {
  return yaml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#"));
}

/** Real assignments only: the template mentions lookup_order in a comment. */
function assignmentCount(dir: string, tool: string): number {
  return agentsYaml(dir)
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .filter((line) => line.includes(tool)).length;
}

describe("tools.assign", () => {
  it("gives one tool to several people in one message", async () => {
    const { server, dir } = await office();
    const ids = server.office.agentsFile.agents.slice(0, 2).map((a) => a.id);

    const result = await handle(server.office, {
      type: "tools.assign",
      reqId: "r1",
      name: "lookup_order",
      agentIds: ids,
    });

    expect(result.ok).toBe(true);
    expect((result.result as { assigned: string[] }).assigned).toEqual(ids);

    expect(assignmentCount(dir, "lookup_order")).toBe(2);
  });

  it("shows up on agents[].tools in the next state", async () => {
    const { server } = await office();
    const id = server.office.agentsFile.agents[0]?.id as string;

    await handle(server.office, {
      type: "tools.assign",
      reqId: "r1",
      name: "lookup_order",
      agentIds: [id],
    });

    const agent = server.office.agentsFile.agents.find((a) => a.id === id);
    expect(agent?.tools).toContain("lookup_order");
  });

  it("keeps the rest of the owner's file, comments and all", async () => {
    const { server, dir } = await office();
    // Trimmed, because the yaml writer normalises line endings and on Windows
    // the template arrives with CRLF. What is protected here is the owner's
    // comments surviving the write, not which bytes end their lines.
    const comments = commentsIn(agentsYaml(dir));
    const id = server.office.agentsFile.agents[0]?.id as string;

    await handle(server.office, {
      type: "tools.assign",
      reqId: "r1",
      name: "lookup_order",
      agentIds: [id],
    });

    expect(commentsIn(agentsYaml(dir))).toEqual(comments);
  });

  it("reports the names that did not take, and still assigns the rest", async () => {
    const { server } = await office();
    const real = server.office.agentsFile.agents[0]?.id as string;

    const result = await handle(server.office, {
      type: "tools.assign",
      reqId: "r1",
      name: "lookup_order",
      agentIds: [real, "nobody_by_that_name"],
    });

    expect(result.ok).toBe(true);
    const payload = result.result as { assigned: string[]; failed?: string[] };
    expect(payload.assigned).toEqual([real]);
    expect(payload.failed).toEqual(["nobody_by_that_name"]);
  });

  it("fails when not one of the names is real, rather than answering ok", async () => {
    const { server } = await office();

    const result = await handle(server.office, {
      type: "tools.assign",
      reqId: "r1",
      name: "lookup_order",
      agentIds: ["ghost"],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("ghost");
  });

  it("refuses an empty list rather than writing nothing and saying ok", async () => {
    const { server } = await office();

    const result = await handle(server.office, {
      type: "tools.assign",
      reqId: "r1",
      name: "lookup_order",
      agentIds: [],
    });

    expect(result.ok).toBe(false);
  });

  // Saving the same card twice is an ordinary thing to do. It should not stack
  // the name on the row, and it should not read as a failure.
  it("is idempotent for somebody who already has the tool", async () => {
    const { server, dir } = await office();
    const id = server.office.agentsFile.agents[0]?.id as string;

    for (let i = 0; i < 2; i++) {
      await handle(server.office, {
        type: "tools.assign",
        reqId: `r${i}`,
        name: "lookup_order",
        agentIds: [id],
      });
    }

    expect(assignmentCount(dir, "lookup_order")).toBe(1);
  });
});
