import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Only the smoke test. The perf spec lives in the same folder but needs its
  // own office — thirty-five agents — built by playwright.perf.config.ts, and
  // without this it is picked up here and fails looking for a server that was
  // never started.
  testMatch: /smoke\.spec\.ts/,
  timeout: 60_000,
  // One worker: every test drives the same single office, which is the point.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: process.env["CI"] !== undefined ? "list" : "line",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
});
