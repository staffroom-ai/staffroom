/**
 * `demo.samples`, the answer coming back from the browser.
 *
 * The module underneath is tested in demo/leave.test.ts. What is worth checking
 * here is the part a person can feel: a no is recorded as firmly as a yes, a
 * second click from a second tab is a quiet no-op rather than a red banner, and
 * a partial failure is reported by filename instead of being swallowed.
 */
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTemplate, templateDir } from "@staffroom/templates";
import { afterEach, describe, expect, it } from "vitest";
import { findSampleNotes } from "../demo/leave.js";
import { createServer, type StaffroomServer } from "../index.js";
import { type Handlers, handle } from "./handlers.js";

const servers: StaffroomServer[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function office(): Promise<{ server: StaffroomServer; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-samples-"));
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

/** The deps the hub hands the handler while the question is open. */
function deps(dir: string, recorded: string[]): Handlers {
  return {
    samples: {
      brainDir: join(dir, "brain"),
      record: (answer) => recorded.push(answer),
    },
  };
}

describe("demo.samples", () => {
  it("moves the notes and records the answer", async () => {
    const { server, dir } = await office();
    const recorded: string[] = [];

    const result = await handle(
      server.office,
      { type: "demo.samples", reqId: "r1", remove: true },
      deps(dir, recorded),
    );

    expect(result.ok).toBe(true);
    expect(recorded).toEqual(["removed"]);
    expect(findSampleNotes(join(dir, "brain"))).toEqual([]);
  });

  it("records a no without moving anything", async () => {
    const { server, dir } = await office();
    const recorded: string[] = [];
    const before = findSampleNotes(join(dir, "brain")).length;

    const result = await handle(
      server.office,
      { type: "demo.samples", reqId: "r1", remove: false },
      deps(dir, recorded),
    );

    // Keeping them is a choice, and a choice the office has to write down.
    // Treating it as "ask me later" is how software starts nagging.
    expect(result.ok).toBe(true);
    expect(recorded).toEqual(["kept"]);
    expect(findSampleNotes(join(dir, "brain")).length).toBe(before);
  });

  it("answers a second click quietly instead of erroring", async () => {
    // Two tabs, both showing the card. The second one to arrive is somebody
    // answering a question that has already been answered, not a failure.
    const { server } = await office();
    const result = await handle(server.office, { type: "demo.samples", reqId: "r1", remove: true });
    expect(result.ok).toBe(true);
  });

  // Skipped on Windows, where chmod does not stop a write and the folder would
  // move happily. The behaviour is the same; only the way to provoke it differs.
  it.skipIf(process.platform === "win32")("names the notes it could not move", async () => {
    const { server, dir } = await office();
    const recorded: string[] = [];

    // A read-only folder is the everyday version of this: a synced brain, or a
    // folder somebody locked. The office has to say which files are still there.
    const locked = join(dir, "brain", "00-about");
    chmodSync(locked, 0o500);
    try {
      const result = await handle(
        server.office,
        { type: "demo.samples", reqId: "r1", remove: true },
        deps(dir, recorded),
      );

      expect(result.ok).toBe(false);
      const error = result.error as { message: string };
      expect(error.message).toContain("00-about/");
      // Still recorded: half a move is not a reason to ask the question again.
      expect(recorded).toEqual(["removed"]);
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});
