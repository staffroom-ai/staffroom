/**
 * Every adapter, same seven exchanges, no network. Add a row to TARGETS when you
 * add an adapter; the suite is the contract.
 */

import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { type ConformanceTarget, runConformanceSuite } from "../testing/conformance.js";
import { FixtureAdapter } from "../testing/fixture-adapter.js";

const demoFixtures = fileURLToPath(new URL("../testing/fixtures/demo", import.meta.url));

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
