/**
 * The run a new office already has behind it.
 *
 * An office whose first impression is an empty Activity feed and a brain graph
 * where nobody has read anything teaches the wrong thing: it looks like a filing
 * cabinet rather than somewhere work happens. A template can therefore ship one
 * run that already happened, and it is written into the run log the first time
 * the office opens.
 *
 * Three rules keep this from being a lie:
 *
 *   It is marked `sample: true`, the same as the template's notes, so the office
 *   can offer to clear it out the moment the owner goes live.
 *
 *   It is only ever written into an empty run log. A seed that could land in an
 *   office with real work in it would be the office inventing history.
 *
 *   A seed that will not read is skipped in silence. It is sample content: worth
 *   having, never worth failing to open the office over.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run, RunEvent, RunStore } from "./events.js";

/** Where `copyTemplate` puts it: our folder, not the owner's. */
export function sampleRunPath(officeDir: string): string {
  return join(officeDir, ".staffroom", "sample-run.json");
}

interface SampleRunFile {
  run: Omit<Run, "status" | "finishedAt" | "usage" | "costUsd" | "createdAt"> & {
    createdAt: string | number;
  };
  events: RunEvent[];
}

export function readSampleRun(officeDir: string): SampleRunFile | undefined {
  const path = sampleRunPath(officeDir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SampleRunFile;
    if (typeof parsed?.run?.id !== "string" || !Array.isArray(parsed.events)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Writes the template's run, if there is one and the log is empty.
 *
 * Returns the run id when it wrote one, so a caller can say so, and undefined
 * every other time — which is every time after the first.
 */
export async function seedSampleRun(
  officeDir: string,
  store: RunStore,
): Promise<string | undefined> {
  const seed = readSampleRun(officeDir);
  if (seed === undefined) return undefined;

  try {
    // The one check that matters. Anything already in the log means this office
    // has a past of its own and is not ours to add to.
    const existing = await store.list({ limit: 1 });
    if (existing.length > 0) return undefined;

    const createdAt =
      typeof seed.run.createdAt === "number" ? seed.run.createdAt : Date.parse(seed.run.createdAt);

    const run = await store.create({
      ...seed.run,
      sample: true,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    });

    // Stamped at the run's own time rather than now. A note dated in March with
    // a card saying it was filed a moment ago is a small lie, and the office is
    // not allowed small lies about when work happened. The events are spread a
    // few seconds apart so the order is stable and the run has a duration.
    const base = run.createdAt;
    for (const [index, event] of seed.events.entries()) {
      await store.append(run.id, event, base + index * 1_000);
    }
    return run.id;
  } catch {
    // Sample content is worth having and never worth failing to open over.
    return undefined;
  }
}
