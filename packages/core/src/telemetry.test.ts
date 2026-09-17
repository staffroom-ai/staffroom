/**
 * The one piece of code that could make the project's claim false.
 *
 * "Your business stays on your machine" is what Staffroom is for, so these tests
 * are less about telemetry working and more about it not happening. The
 * acceptance case — nothing leaves the process while telemetry is off — is
 * checked by giving the module a sender that fails the test if it is ever
 * called, which is stronger evidence than a packet capture: a capture proves
 * nothing was seen on one interface, this proves the code has no path there.
 *
 * The payload is snapshotted whole. A new field is then a failing test and a
 * conversation, rather than something that ships because nobody was looking.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelemetryOptions } from "./telemetry.js";
import { installId, Telemetry, telemetryAllowed, telemetryIdPath } from "./telemetry.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function office(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-telemetry-"));
  dirs.push(dir);
  return dir;
}

/** A sender that fails the test if anything ever reaches it. */
const never = vi.fn(async () => {
  throw new Error("something tried to send telemetry");
});

function telemetry(over: Partial<TelemetryOptions> = {}): Telemetry {
  return new Telemetry({
    officeDir: office(),
    enabled: true,
    version: "0.2.0",
    mode: "live",
    providers: ["anthropic"],
    agentCount: 4,
    toolSources: { mcp: 1, custom: 2 },
    env: {},
    send: never,
    ...over,
  });
}

describe("when nothing may be sent", () => {
  it("is off by default, which is what an absent config block means", () => {
    expect(telemetryAllowed({ enabled: false, mode: "live", env: {} })).toBe(false);
  });

  it("is off in demo mode however the config reads", () => {
    // Somebody looking at this for the first time has not agreed to anything.
    expect(telemetryAllowed({ enabled: true, mode: "demo", env: {} })).toBe(false);
  });

  it("is off when the environment says so, even with the file saying yes", () => {
    expect(
      telemetryAllowed({ enabled: true, mode: "live", env: { STAFFROOM_TELEMETRY: "0" } }),
    ).toBe(false);
  });

  it("sends nothing at all across a whole session with it off", async () => {
    // The acceptance case. Every event a real session produces, and a flush and
    // a close on top, with a sender that throws if it is ever reached.
    const sender = vi.fn(async () => {});
    const off = telemetry({ enabled: false, send: sender });

    off.record("start");
    for (let i = 0; i < 50; i++) {
      off.record("run_done", { runDurationMs: 1234, runOutcome: "done", approvalUsed: false });
    }
    await off.flush();
    await off.close();

    expect(sender).not.toHaveBeenCalled();
  });

  it("writes no install id when it is off", () => {
    // An office that never opted in should not be carrying an identifier.
    const dir = office();
    new Telemetry({
      officeDir: dir,
      enabled: false,
      version: "0.2.0",
      mode: "live",
      providers: [],
      agentCount: 1,
      toolSources: { mcp: 0, custom: 0 },
      env: {},
      send: never,
    });
    expect(() => readFileSync(telemetryIdPath(dir), "utf8")).toThrow();
  });
});

describe("the payload", () => {
  it("is exactly this shape, and nothing else", () => {
    const event = telemetry().build("run_done", {
      runDurationMs: 1234,
      runOutcome: "done",
      approvalUsed: true,
    });

    expect({ ...event, installId: "<uuid>" }).toMatchInlineSnapshot(`
      {
        "agentCount": 4,
        "approvalUsed": true,
        "event": "run_done",
        "installId": "<uuid>",
        "node": "${process.versions.node.split(".")[0]}",
        "os": "${process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux"}",
        "providers": [
          "anthropic",
        ],
        "runDurationMs": 1200,
        "runOutcome": "done",
        "toolSources": {
          "custom": 2,
          "mcp": 1,
        },
        "v": 1,
        "version": "0.2.0",
      }
    `);
  });

  it("has no field any of the forbidden things could travel in", () => {
    const event = telemetry().build("run_done", { runDurationMs: 100, runOutcome: "done" });
    const keys = Object.keys(event);

    // The list from repo-quality-launch.md §9. Checked as absent keys rather
    // than as absent values: a value can be empty today and full tomorrow.
    for (const forbidden of [
      "task",
      "prompt",
      "text",
      "deliverable",
      "note",
      "brain",
      "agentName",
      "agentNames",
      "toolName",
      "toolNames",
      "server",
      "servers",
      "hostname",
      "host",
      "key",
      "apiKey",
      "error",
      "message",
      "path",
      "officeName",
      "model",
      "models",
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("rounds the duration to 100 ms", () => {
    // A millisecond figure is a better fingerprint than it looks.
    expect(telemetry().build("run_done", { runDurationMs: 1_234 }).runDurationMs).toBe(1_200);
    expect(telemetry().build("run_done", { runDurationMs: 49 }).runDurationMs).toBe(0);
  });

  it("carries provider kinds, never models", () => {
    const event = telemetry({ providers: ["ollama", "anthropic"] }).build("start");
    // Sorted, so two offices with the same providers produce the same value
    // rather than one that depends on map ordering.
    expect(event.providers).toEqual(["anthropic", "ollama"]);
    expect(JSON.stringify(event)).not.toContain("claude");
  });

  it("reports only the Node major version", () => {
    expect(telemetry().build("start").node).not.toContain(".");
  });

  it("leaves run fields out of a start event", () => {
    const event = telemetry().build("start");
    expect(event).not.toHaveProperty("runDurationMs");
    expect(event).not.toHaveProperty("runOutcome");
    expect(event).not.toHaveProperty("approvalUsed");
  });
});

describe("the install id", () => {
  it("is made once and then read", () => {
    const dir = office();
    const first = installId(dir);
    expect(installId(dir)).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is different for a different office", () => {
    expect(installId(office())).not.toBe(installId(office()));
  });

  it("is a file the owner can delete", () => {
    const dir = office();
    const first = installId(dir);
    rmSync(telemetryIdPath(dir));
    // A new id rather than the same one recomputed: an id derived from the
    // hostname or the path would come back identical and the deletion would
    // have meant nothing.
    expect(installId(dir)).not.toBe(first);
  });
});

describe("sending", () => {
  it("batches rather than sending one request per event", async () => {
    const sent: unknown[][] = [];
    const on = telemetry({
      send: async (_endpoint, events) => {
        sent.push([...events]);
      },
    });

    on.record("start");
    on.record("run_done", { runOutcome: "done" });
    await on.flush();

    expect(sent.length).toBe(1);
    expect(sent[0]?.length).toBe(2);
  });

  it("does not send an empty batch", async () => {
    const sender = vi.fn(async () => {});
    await telemetry({ send: sender }).flush();
    expect(sender).not.toHaveBeenCalled();
  });

  it("drops a failed batch rather than growing forever", async () => {
    let calls = 0;
    const on = telemetry({
      send: async () => {
        calls += 1;
        throw new Error("collector is down");
      },
    });

    on.record("start");
    await on.flush();
    await on.flush();

    // The second flush had nothing left to send: these are counts, and a queue
    // that grows while a collector is down is a leak in somebody's office.
    expect(calls).toBe(1);
  });

  it("goes to the endpoint the office configured", async () => {
    let seen = "";
    const on = telemetry({
      endpoint: "https://t.example.internal/v1",
      send: async (endpoint) => {
        seen = endpoint;
      },
    });
    on.record("start");
    await on.flush();
    expect(seen).toBe("https://t.example.internal/v1");
  });
});
