/**
 * Every adapter, same seven exchanges, no network. Add a row to TARGETS when you
 * add an adapter; the suite is the contract.
 */

import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { type ConformanceTarget, runConformanceSuite } from "../testing/conformance.js";
import { FixtureAdapter } from "../testing/fixture-adapter.js";

const demoFixtures = fileURLToPath(new URL("../testing/fixtures/demo", import.meta.url));

/**
 * To add a real adapter, record its fixtures first:
 *
 *   STAFFROOM_RECORD=1 ANTHROPIC_API_KEY=... pnpm --filter @staffroom/core record
 *
 * then point a FixtureAdapter at that directory and give the row the adapter's own
 * class. Until an adapter has recorded fixtures it is covered by its own stubbed
 * stream tests (anthropic-stream.test.ts, openai-stream.test.ts), which assert the
 * same rules against a scripted SDK rather than a recorded exchange.
 */
const TARGETS: ConformanceTarget[] = [
  {
    name: "FixtureAdapter",
    model: "demo",
    make: () => new FixtureAdapter(demoFixtures, { delayMs: 0 }),
  },
];

for (const target of TARGETS) {
  describe(`conformance: ${target.name}`, () => {
    runConformanceSuite(target);
  });
}
