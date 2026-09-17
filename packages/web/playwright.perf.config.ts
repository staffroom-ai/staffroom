/**
 * The perf run, separate from the smoke run.
 *
 * Its own config because it needs its own office: the smoke test drives the
 * shipped studio template, and this one needs that same office with thirty-five
 * people in it. Sharing a config would mean one of the two tests measuring
 * something it did not ask for.
 *
 * The timeout is long on purpose — three seconds of warm-up and ten of
 * recording is thirteen before a single assertion runs.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /office-perf\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  // No retries. A perf number that only passes on the second attempt is a perf
  // number nobody should believe.
  retries: 0,
  reporter: "list",
  globalSetup: "./e2e/perf-setup.ts",
  globalTeardown: "./e2e/perf-teardown.ts",
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
    // Software WebGL on a headless runner would measure the CPU rasteriser
    // rather than the scene. These ask Chromium for the real thing.
    launchOptions: {
      args: [
        "--use-angle=default",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
});
