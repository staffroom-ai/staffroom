/**
 * The once-a-day "there is a newer version" line.
 *
 * It is a request nobody asked for, so it is tied to the telemetry switch. That
 * is stricter than most tools — plenty check for updates regardless — and the
 * reason is the same as everywhere else here: an office that reaches the network
 * while the owner believes nothing leaves the machine has broken the only
 * promise the project makes, and "it was only the version number" is not a
 * defence anybody should have to accept.
 *
 * Nothing in this file reaches the network: the fetch is injected, and the tests
 * that check the "off" paths inject one that fails if it is called.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL_MS,
  checkForUpdate,
  isNewer,
  readUpdateCheck,
  updateCheckPath,
  writeUpdateCheck,
} from "./update-check.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-update-"));
  homes.push(dir);
  return dir;
}

const never = vi.fn(async () => {
  throw new Error("something tried to reach the registry");
});

describe("when it must not ask at all", () => {
  it("says nothing when telemetry is off", async () => {
    const fetchLatest = vi.fn(async () => "9.9.9");
    expect(
      await checkForUpdate({
        current: "0.2.0",
        telemetryEnabled: false,
        env: {},
        home: home(),
        fetchLatest,
      }),
    ).toBeUndefined();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("says nothing when the environment turns it off, telemetry on or not", async () => {
    const fetchLatest = vi.fn(async () => "9.9.9");
    expect(
      await checkForUpdate({
        current: "0.2.0",
        telemetryEnabled: true,
        env: { STAFFROOM_NO_UPDATE_CHECK: "1" },
        home: home(),
        fetchLatest,
      }),
    ).toBeUndefined();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("says nothing in demo mode, which is what the caller passes in", async () => {
    // Found by running a demo office with the flag on: telemetry correctly
    // stayed silent and this reached npm anyway, which makes "demo mode never
    // sends anything" false. The caller passes the answer to "may anything be
    // sent at all", not the raw config flag.
    const fetchLatest = vi.fn(async () => "9.9.9");
    expect(
      await checkForUpdate({
        current: "0.2.0",
        telemetryEnabled: false, // what telemetry.on reports in demo mode
        env: {},
        home: home(),
        fetchLatest,
      }),
    ).toBeUndefined();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("writes no file when it is not allowed to ask", async () => {
    const dir = home();
    await checkForUpdate({
      current: "0.2.0",
      telemetryEnabled: false,
      env: {},
      home: dir,
      fetchLatest: never,
    });
    expect(() => readFileSync(updateCheckPath(dir), "utf8")).toThrow();
  });
});

describe("once a day", () => {
  it("asks the first time and remembers the answer", async () => {
    const dir = home();
    const line = await checkForUpdate({
      current: "0.2.0",
      telemetryEnabled: true,
      env: {},
      home: dir,
      now: 1_000_000,
      fetchLatest: async () => "0.3.0",
    });

    expect(line).toBe("Update available: 0.3.0 (you have 0.2.0). Run npx staffroom@latest.");
    expect(readUpdateCheck(dir)).toEqual({ checkedAt: 1_000_000, latest: "0.3.0" });
  });

  it("answers from the file within the day, without asking again", async () => {
    const dir = home();
    writeUpdateCheck({ checkedAt: 1_000_000, latest: "0.3.0" }, dir);

    const line = await checkForUpdate({
      current: "0.2.0",
      telemetryEnabled: true,
      env: {},
      home: dir,
      now: 1_000_000 + CHECK_INTERVAL_MS - 1,
      fetchLatest: never,
    });

    expect(line).toContain("0.3.0");
  });

  it("asks again once the day is up", async () => {
    const dir = home();
    writeUpdateCheck({ checkedAt: 1_000_000, latest: "0.3.0" }, dir);

    const line = await checkForUpdate({
      current: "0.2.0",
      telemetryEnabled: true,
      env: {},
      home: dir,
      now: 1_000_000 + CHECK_INTERVAL_MS,
      fetchLatest: async () => "0.4.0",
    });

    expect(line).toContain("0.4.0");
  });

  it("does not ask again for a day after the registry failed", async () => {
    // Otherwise a registry that is down is asked on every single start.
    const dir = home();
    await checkForUpdate({
      current: "0.2.0",
      telemetryEnabled: true,
      env: {},
      home: dir,
      now: 1_000_000,
      fetchLatest: async () => {
        throw new Error("no answer");
      },
    });

    expect(readUpdateCheck(dir).checkedAt).toBe(1_000_000);
    expect(readUpdateCheck(dir).latest).toBeUndefined();
  });

  it("treats a file somebody edited as never having checked", () => {
    const dir = home();
    writeUpdateCheck({ checkedAt: 1 }, dir);
    writeFileSync(updateCheckPath(dir), "{not json", "utf8");
    expect(readUpdateCheck(dir)).toEqual({ checkedAt: 0 });
  });
});

describe("which version counts as newer", () => {
  it("compares numerically, not as text", () => {
    // The one that bites: "0.10.0" sorts before "0.9.0" as a string.
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.9.0", "0.10.0")).toBe(false);
  });

  it("says no to the same version, and to an older one", () => {
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
  });

  it("handles a shorter version as though the missing parts were zero", () => {
    expect(isNewer("1", "0.9.9")).toBe(true);
    expect(isNewer("0.2", "0.2.0")).toBe(false);
  });

  it("never offers a prerelease to somebody on a stable release", () => {
    expect(isNewer("0.3.0-beta.1", "0.2.0")).toBe(false);
  });

  it("says no to anything it cannot read, rather than guessing", () => {
    expect(isNewer("latest", "0.2.0")).toBe(false);
    expect(isNewer("", "0.2.0")).toBe(false);
  });

  it("says nothing when there is nothing newer", async () => {
    expect(
      await checkForUpdate({
        current: "0.2.0",
        telemetryEnabled: true,
        env: {},
        home: home(),
        fetchLatest: async () => "0.2.0",
      }),
    ).toBeUndefined();
  });
});
