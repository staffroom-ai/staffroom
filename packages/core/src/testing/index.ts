/**
 * @staffroom/core/testing — fixtures and fakes.
 *
 * Shipped rather than kept in the test folder on purpose: community adapters need
 * the same fixtures we hold our own adapters to, and demo mode replays through
 * FixtureAdapter in ordinary use.
 *
 * Nothing here may import vitest. The conformance suite does, so it lives at
 * `@staffroom/core/testing/conformance` instead: demo mode imports this file at
 * startup, and when the suite was re-exported from here every installed copy of
 * the CLI died on launch with "Cannot find package 'vitest'" — vitest is an
 * optional peer, so it is present in this repo and absent everywhere else.
 */

export type { FixtureAdapterOptions, FixtureHeader } from "./fixture-adapter.js";
export { FixtureAdapter, hashRequest } from "./fixture-adapter.js";
export type { RecordOptions } from "./record-fixture.js";
export { recordFixture, redactForFixture } from "./record-fixture.js";
