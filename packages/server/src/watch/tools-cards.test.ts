/**
 * What the office says when a tool file lands in office/tools/.
 *
 * Three pieces of news come out of one save, and each of them exists because of
 * a way a custom tool can quietly go wrong: it did not compile and nobody said
 * where, it has no scope so it will interrupt the owner on every call, or it
 * loaded perfectly and nobody can use it. None of them may stop the office: a
 * broken file is a card, not an outage.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type StaffroomServer } from "../index.js";
import { OfficeWatchers, type WatchEvent } from "./index.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];
const started: OfficeWatchers[] = [];

afterEach(async () => {
  for (const w of started.splice(0)) await w.close();
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GOOD = `
import { z } from "zod";
import { tool } from "@staffroom/core";

export default tool({
  name: "NAME",
  description: "Looks something up.",
  SCOPE
  input: z.object({ id: z.string() }),
  async run({ id }) {
    return { id };
  },
});
`;

function source(name: string, scope?: "read" | "write"): string {
  return GOOD.replace("NAME", name).replace(
    "SCOPE",
    scope === undefined ? "" : `scope: "${scope}",`,
  );
}

/** Writes a tool file and waits for the card the watcher pushes about it. */
async function cardFor(
  content: string,
  file = "lookup.ts",
): Promise<Extract<WatchEvent, { type: "tools.reloaded" }>> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-toolcard-"));
  dirs.push(dir);
  copyTemplate("studio", dir);
  const toolsDir = join(dir, "tools");
  await mkdir(toolsDir, { recursive: true });

  const server = await createServer({
    officeDir: dir,
    port: 0,
    watch: false,
    demoRunsDir: join(templateDir("studio"), "demo-runs"),
  });
  servers.push(server);

  return await new Promise((resolve, reject) => {
    const watchers = new OfficeWatchers({
      officeDir: dir,
      office: server.office,
      onEvent: (event) => {
        if (event.type === "tools.reloaded") resolve(event);
      },
    });
    started.push(watchers);
    watchers.start();

    setTimeout(() => reject(new Error("no tools.reloaded arrived")), 15_000);
    // After the watcher is listening, or the add is missed entirely.
    setTimeout(() => writeFileSync(join(toolsDir, file), content, "utf8"), 150);
  });
}

describe("a tool file that will not load", () => {
  it("says so, with the line the compiler blamed", async () => {
    const card = await cardFor("export default tool({\n", "broken.ts");

    expect(card.ok).toBe(false);
    expect(card.file).toBe("broken.ts");
    expect(card.message).toBeTruthy();
    expect(card.line).toBeGreaterThan(0);
  }, 20_000);

  it("does not stop the office answering", async () => {
    await cardFor("export default tool({\n", "broken.ts");
    const server = servers[servers.length - 1] as StaffroomServer;
    // The office is still there, with its roster, after a file it could not read.
    expect(server.office.agentsFile.agents.length).toBeGreaterThan(0);
  }, 20_000);
});

describe("a tool file with no scope", () => {
  it("warns that it will ask for approval every time", async () => {
    const card = await cardFor(source("lookup_order"));

    expect(card.ok).toBe(true);
    expect(card.warning).toBe("no_scope");
    expect(card.name).toBe("lookup_order");
  }, 20_000);

  it("says nothing about scope when the author wrote one", async () => {
    const card = await cardFor(source("lookup_order", "read"));

    expect(card.ok).toBe(true);
    expect(card.warning).toBeUndefined();
  }, 20_000);
});

describe("a tool nobody may use yet", () => {
  it("asks who may use it, and offers everyone on the roster", async () => {
    const card = await cardFor(source("lookup_order", "read"));

    expect(card.unassigned).toBe(true);
    expect(card.agents?.length).toBeGreaterThan(0);
    // Named, because the card puts these beside checkboxes for a person to read.
    expect(card.agents?.every((agent) => agent.name.length > 0)).toBe(true);
  }, 20_000);

  it("does not ask again about a tool somebody already has", async () => {
    // web is on the researcher's row in the studio template.
    const card = await cardFor(source("web", "read"), "web.ts");

    expect(card.ok).toBe(true);
    expect(card.unassigned).toBeUndefined();
    expect(card.agents).toBeUndefined();
  }, 20_000);
});
