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
import { parse } from "yaml";
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

describe("the office's own name", () => {
  it("renames the running office, not just the file", async () => {
    // The first thing anybody wants to change after opening a template, and it
    // was only reachable by editing agents.yaml by hand.
    const { server, dir } = await office();
    const result = await handle(server.office, {
      type: "office.rename",
      reqId: "r1",
      name: "Chhabra Works",
    });

    expect(result.ok).toBe(true);
    expect(server.office.roster.officeName).toBe("Chhabra Works");
    expect(readFileSync(join(dir, "agents.yaml"), "utf8")).toContain("Chhabra Works");
  });

  it("refuses an empty name rather than leaving the office unnamed", async () => {
    const { server } = await office();
    const result = await handle(server.office, { type: "office.rename", reqId: "r1", name: "  " });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("needs a name");
  });
});

describe("departments", () => {
  it("opens one by hiring the first person into it", async () => {
    /*
     * One message, not two.
     *
     * `departments:` in agents.yaml is a map of display names, not a list, so a
     * department exists because somebody works in it. Opening one on its own
     * wrote a label that nothing could use and nothing showed — not the room,
     * not Settings, and not the hire form's own department list, so the person
     * who had just opened one could not put anybody in it. A tester found it
     * within minutes: "opening a department is not reflecting".
     */
    const { server } = await office();

    const hired = await handle(server.office, {
      type: "agent.create",
      reqId: "r1",
      agent: {
        ...NEW_HIRE,
        id: "helper",
        department: "support",
        departmentLabel: "Support",
      },
    });

    expect(hired.ok).toBe(true);
    expect(server.office.roster.department("support")?.label).toBe("Support");
    expect(server.office.roster.seatOf("helper")?.department).toBe("support");
  });

  it("still refuses an unknown department when no name for it was given", async () => {
    // The label is what says "yes, open this one". Without it, a typo in the
    // department is a typo, not a new department nobody meant to make.
    const { server } = await office();
    const result = await handle(server.office, {
      type: "agent.create",
      reqId: "r1",
      agent: { ...NEW_HIRE, id: "helper", department: "nowhere" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("no department called nowhere");
  });

  it("closes a department when the last person in it moves out", async () => {
    // There is no "close a department" button for this reason: the wedges are
    // drawn from where people sit, so the last one to leave takes it with them.
    const { server } = await office();
    await handle(server.office, {
      type: "agent.create",
      reqId: "r1",
      agent: { ...NEW_HIRE, id: "helper", department: "support", departmentLabel: "Support" },
    });
    expect(server.office.roster.department("support")).toBeDefined();

    await handle(server.office, {
      type: "agent.update",
      reqId: "r2",
      agentId: "helper",
      fields: { department: "marketing" },
    });

    expect(server.office.roster.department("support")).toBeUndefined();
    expect(server.office.roster.seatOf("helper")?.department).toBe("marketing");
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

describe("connectors", () => {
  /*
   * Adding Gmail from Settings.
   *
   * Four lines of YAML in a file most people will never open, and the two
   * questions that matter — is it connected, and who can use it — had no answer
   * anywhere in the office. The office re-reads config.yaml after each of these,
   * so a connector added here is connected without a restart.
   */
  it("writes the server into config.yaml and keeps the file's comments", async () => {
    const { server, dir } = await office();
    const result = await handle(server.office, {
      type: "connector.add",
      reqId: "r1",
      name: "gmail",
      server: { url: "https://mcp.example.com/gmail", auth: "oauth" },
    });

    expect(result.ok).toBe(true);
    const config = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      mcp: { servers: Record<string, { url?: string }> };
    };
    expect(config.mcp.servers["gmail"]?.url).toBe("https://mcp.example.com/gmail");
    // The commented examples that teach the file survive a write from Settings.
    expect(readFileSync(join(dir, "config.yaml"), "utf8")).toContain(
      "Keys live in office/.env, never here.",
    );
  });

  /*
   * A client the owner registered, and where its secret goes.
   *
   * Google's Gmail MCP server does not do dynamic client registration — you
   * create a client in the Cloud console and bring its id and secret. Without
   * somewhere to put them that server cannot be signed in to at all.
   */
  it("keeps an OAuth client secret out of config.yaml", async () => {
    const { server, dir } = await office();
    const result = await handle(server.office, {
      type: "connector.add",
      reqId: "r1",
      name: "gmail",
      server: {
        url: "https://gmailmcp.googleapis.com/mcp/v1",
        auth: "oauth",
        client_id: "123.apps.googleusercontent.com",
        client_secret: "$GMAIL_OAUTH_CLIENT_SECRET",
      },
      secrets: { GMAIL_OAUTH_CLIENT_SECRET: "the-actual-secret" },
    });

    expect(result.ok).toBe(true);
    // config.yaml is the file owners paste into issues and screenshots.
    const config = readFileSync(join(dir, "config.yaml"), "utf8");
    expect(config).not.toContain("the-actual-secret");
    expect(config).toContain("$GMAIL_OAUTH_CLIENT_SECRET");
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain(
      "GMAIL_OAUTH_CLIENT_SECRET=the-actual-secret",
    );
  });

  it("refuses a variable name that is not one, before writing the config", async () => {
    const { server, dir } = await office();
    const result = await handle(server.office, {
      type: "connector.add",
      reqId: "r1",
      name: "gmail",
      server: { url: "https://gmailmcp.googleapis.com/mcp/v1", auth: "oauth" },
      secrets: { "not a name": "x" },
    });

    expect(result.ok).toBe(false);
    // Nothing half-written: a config pointing at a variable that was refused is
    // a connector that reads as broken for a reason nobody can see.
    const config = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      mcp: { servers: Record<string, unknown> };
    };
    expect(config.mcp.servers["gmail"]).toBeUndefined();
  });

  it("wires it to departments, and to every department when the list is empty", async () => {
    const { server, dir } = await office();
    await handle(server.office, {
      type: "connector.add",
      reqId: "r1",
      name: "gmail",
      server: { url: "https://mcp.example.com/gmail", auth: "oauth" },
    });

    await handle(server.office, {
      type: "connector.scope",
      reqId: "r2",
      name: "gmail",
      departments: ["marketing"],
    });
    const wired = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      mcp: { departments: Record<string, string[]> };
    };
    expect(wired.mcp.departments["gmail"]).toEqual(["marketing"]);

    // Absence, not an empty list: absent is what the registry reads as "every
    // department", so the file should say the same thing the office does.
    await handle(server.office, {
      type: "connector.scope",
      reqId: "r3",
      name: "gmail",
      departments: [],
    });
    const cleared = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      mcp: { departments: Record<string, unknown> };
    };
    expect(cleared.mcp.departments["gmail"]).toBeUndefined();
  });

  it("takes the wiring away with the server", async () => {
    const { server, dir } = await office();
    await handle(server.office, {
      type: "connector.add",
      reqId: "r1",
      name: "gmail",
      server: { url: "https://mcp.example.com/gmail", auth: "oauth" },
    });
    await handle(server.office, {
      type: "connector.scope",
      reqId: "r2",
      name: "gmail",
      departments: ["marketing"],
    });

    await handle(server.office, { type: "connector.remove", reqId: "r3", name: "gmail" });

    /*
     * Parsed, not grepped. The shipped template carries a commented-out gmail
     * example with the same URL in it, so a text search finds the comment and
     * passes whether or not the entry was ever removed.
     */
    const config = parse(readFileSync(join(dir, "config.yaml"), "utf8")) as {
      mcp: { servers: Record<string, unknown>; departments: Record<string, unknown> };
    };
    expect(config.mcp.servers["gmail"]).toBeUndefined();
    // A department list for a server nobody has is a line the owner would find
    // later and not understand.
    expect(config.mcp.departments["gmail"]).toBeUndefined();
  });

  it("gives a connector to one person and takes it back", async () => {
    const { server } = await office();
    const has = (id: string) => server.office.roster.agent(id)?.tools?.includes("gmail") === true;

    await handle(server.office, {
      type: "agent.update",
      reqId: "r1",
      agentId: "copywriter",
      fields: { tools: ["gmail"] },
    });
    expect(has("copywriter")).toBe(true);
    // Nobody else, which is the whole point of asking.
    expect(has("bookkeeper")).toBe(false);

    await handle(server.office, {
      type: "agent.update",
      reqId: "r2",
      agentId: "copywriter",
      fields: { tools: [] },
    });
    expect(has("copywriter")).toBe(false);
  });
});
