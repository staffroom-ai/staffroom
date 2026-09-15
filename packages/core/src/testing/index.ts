/**
 * @staffroom/core/testing — fixtures and fakes.
 *
 * Shipped rather than kept in the test folder on purpose: community adapters need
 * the same conformance suite we hold our own adapters to.
 */

export type { ConformanceFixture, ConformanceTarget } from "./conformance.js";
export {
  CONFORMANCE_FIXTURES,
  CONFORMANCE_REQUESTS,
  runConformanceSuite,
} from "./conformance.js";
export type { FixtureAdapterOptions, FixtureHeader } from "./fixture-adapter.js";
export { FixtureAdapter, hashRequest } from "./fixture-adapter.js";
export type { RecordOptions } from "./record-fixture.js";
export { recordFixture, redactForFixture } from "./record-fixture.js";
