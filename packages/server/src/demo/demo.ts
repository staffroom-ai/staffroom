/**
 * Demo mode: the office working before anything is configured.
 *
 * A first-time visitor should see agents doing work inside a minute, without an
 * API key, without a credit card, and without reading anything. That is what this
 * is for. It replays recorded transcripts through the same loop, the same tools
 * and the same approval gate a live run uses, so what they see is the real thing
 * with a scripted model behind it.
 *
 * The server never imports @staffroom/templates: the CLI passes the transcript
 * folder in, and a copied office has its own under .staffroom/demo-runs.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderAdapter } from "@staffroom/core";
import { FixtureAdapter } from "@staffroom/core/testing";

export const DEMO_PROVIDER = "demo";

/** Where a copied office keeps its transcripts. */
export function officeDemoRuns(officeDir: string): string {
  return join(officeDir, ".staffroom", "demo-runs");
}

export const NO_TRANSCRIPTS =
  "Demo mode needs transcripts. Run npx staffroom init again, or pass --office to a folder created by it.";

export interface DemoOptions {
  officeDir: string;
  /** From the CLI, pointing at the shipped template. */
  demoRunsDir?: string;
}

/** The first folder that actually has transcripts, or undefined. */
export function findDemoRuns(options: DemoOptions): string | undefined {
  const candidates = [options.demoRunsDir, officeDemoRuns(options.officeDir)].filter(
    (c): c is string => c !== undefined,
  );
  // generic.jsonl is the fallback transcript, so a folder without one cannot
  // answer an arbitrary task and is not usable as a demo source.
  return candidates.find((dir) => existsSync(join(dir, "generic.jsonl")));
}

/**
 * Builds the adapter map for a demo office. Throws with an instruction rather
 * than starting an office where every task fails.
 */
export function demoAdapters(options: DemoOptions): Map<string, ProviderAdapter> {
  const dir = findDemoRuns(options);
  if (dir === undefined) throw new Error(NO_TRANSCRIPTS);
  return new Map([[DEMO_PROVIDER, new FixtureAdapter(dir) as ProviderAdapter]]);
}

/**
 * Whether to run in demo mode at all.
 *
 * A provider that is configured but broken is not a reason to fall into demo: the
 * owner would see fake work and think it was real. Only the absence of any
 * provider, or an explicit request, turns it on.
 */
export function shouldUseDemo(options: {
  providerCount: number;
  demoFlag?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (options.demoFlag === true) return true;
  if ((options.env ?? process.env)["STAFFROOM_DEMO"] === "1") return true;
  return options.providerCount === 0;
}

export function setDemoSpeed(adapters: Map<string, ProviderAdapter>, factor: 1 | 2 | 4): boolean {
  const adapter = adapters.get(DEMO_PROVIDER);
  if (adapter instanceof FixtureAdapter) {
    adapter.setSpeed(factor);
    return true;
  }
  return false;
}

export const DEMO_BANNER =
  "Demo mode: no model is configured, so the office is replaying recorded work. " +
  "Open Settings > Models and paste a key to run for real.";
