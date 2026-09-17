/**
 * What the office costs to draw, with more people in it than anybody has.
 *
 * A 3D scene degrades quietly. Nobody reports "the frame time went from five
 * milliseconds to twelve"; they say it feels sluggish six months later, and by
 * then the cause is thirty commits back and nobody can say which one. These
 * numbers exist so that a change which makes the office slower fails in the pull
 * request that made it.
 *
 * Every budget below is a ceiling with real headroom, not a target. The point is
 * to catch a regression of a kind — a mesh that stopped being instanced, a
 * material created per frame, a re-render on every socket message — rather than
 * to police a few percent. A test that fails when nothing is wrong gets muted,
 * and a muted test is worse than none.
 */
import { expect, test } from "@playwright/test";

/**
 * Draw calls: under 60, whatever the headcount.
 *
 * This is the plan's own figure, which was written as an aspiration and is now
 * a measurement. Before and after instancing the people and the desks:
 *
 *   4 agents    108 calls  ->  37 calls    11,892 triangles
 *   35 agents   821 calls  ->  37 calls    91,872 triangles
 *
 * The number that matters is not 821 to 37, it is that the second column no
 * longer has two different numbers in it. The scene used to cost 23 draw calls
 * per person — a body, a head, a beacon, a desk, a chair, a screen, each its own
 * object and most of them drawn a second time for the shadow map — so the office
 * got more expensive with every hire. Instanced, the room costs the same to draw
 * whether it seats four people or forty, and the count only moves when somebody
 * starts work: a lit screen and its pool of floor light are two more meshes, for
 * the whole office rather than per person, which is why a busy office measures
 * 40 rather than 37.
 *
 * Sixty is therefore a real ceiling rather than a padded one. Un-instance any
 * single part and thirty-five people put it over immediately, which is exactly
 * the regression this exists to catch.
 */
const MAX_DRAW_CALLS = 60;

/**
 * Triangles: under 150,000.
 *
 * The plan's figure, and it fits: thirty-five people come to 91,872, so there
 * is real room. It is here to catch somebody dropping in a detailed model — a
 * real chair, a plant from a pack — without noticing that the office now ships
 * a quarter of a million triangles to draw a room nobody looks at closely.
 */
const MAX_TRIANGLES = 150_000;

/*
 * Two kinds of number, and only one of them is a gate.
 *
 * Draw calls and triangles are deterministic. The same scene produces the same
 * counts on a laptop and on a shared CI VM — measured as the same numbers on
 * both — so they are asserted identically everywhere, and they are what this
 * test is for: a part that stopped being instanced, a material built per frame,
 * a model somebody dropped in without looking.
 *
 * Timing on the CI runner is not a gate, because it is not repeatable. Two runs
 * of the identical commit on macos-14:
 *
 *   run 1   311 frames   p95 69.7 ms    137 long   first frame 2,221 ms
 *   run 2   234 frames   p95 105.3 ms   101 long   first frame 2,798 ms
 *
 * Fifty per cent apart with nothing changed. A threshold above that is so wide
 * it would miss a real regression; one below it fails on a runner having a bad
 * minute. Either way somebody eventually mutes the job, and a muted job is
 * worse than no job.
 *
 * So on CI the timings are measured and printed into the step summary — visible
 * and trackable, there when somebody wants to know — and the only timing thing
 * asserted is that the scene rendered at all. Locally, where the same machine
 * gives the same answer twice, the real budgets apply.
 */
const ON_CI = process.env["CI"] !== undefined;

/**
 * p95 frame gap: under 20 ms.
 *
 * The plan asked for 8 ms, which cannot be measured as a gap between frames. On
 * a vsynced renderer that gap has a floor at the display's refresh, and the
 * measurement proves it: p95 was 17.3 ms with four agents and 16.8 ms with
 * thirty-five, so the monitor was being measured rather than the scene. Under
 * 20 ms is the honest version — the office keeps up with a 60 Hz display.
 */
const MAX_P95_MS = 20;

/**
 * Dropped frames: under 2%.
 *
 * The p95 says the office keeps up; this says it does not lurch. A gap over
 * 33 ms is a frame the display asked for and did not get, which is the stutter
 * people mean by janky and exactly what a p95 can hide. Currently zero.
 */
const MAX_LONG_FRAME_RATIO = 0.02;
const LONG_FRAME_MS = 33;

/** The plan's figure, and it holds where timing can be trusted: 781 ms. */
const MAX_FIRST_FRAME_MS = 2_000;

/**
 * The scene rendered, on any machine.
 *
 * Ten seconds of recording, so sixty frames is six a second. Nothing about
 * performance — it is the difference between a slow office and a black canvas,
 * and it is the one timing statement worth making on a runner whose numbers
 * move by half between runs.
 */
const MIN_FRAMES = 60;

/** Long enough for lazy chunks, textures and the first camera move to settle. */
const WARMUP_MS = 3_000;

/** Long enough to include several agents starting and finishing demo runs. */
const RECORD_MS = 10_000;

test("the office stays cheap to draw with thirty-five people in it", async ({ page }) => {
  // Installed before any script runs, so the probe is armed for the very first
  // frame — a first-frame measurement taken after the page loaded would be
  // measuring the wrong thing.
  await page.addInitScript(() => {
    window.__staffroomPerf = { frames: [], calls: 0, triangles: 0, firstFrameMs: null };
  });

  const url = process.env["STAFFROOM_PERF_URL"] as string;
  expect(url, "the perf office did not start").toBeTruthy();
  await page.goto(url);

  // The canvas being present is not the same as it having drawn. Waiting for a
  // frame is what makes the first-frame number mean anything.
  await page.waitForFunction(() => window.__staffroomPerf?.firstFrameMs !== null, undefined, {
    timeout: MAX_FIRST_FRAME_MS * 3,
  });

  const firstFrameMs = await page.evaluate(() => window.__staffroomPerf?.firstFrameMs ?? 0);

  await page.waitForTimeout(WARMUP_MS);

  // Cleared after warm-up: the first seconds include compiling shaders and
  // uploading textures, which happen once and are not what anybody experiences
  // while using the office.
  await page.evaluate(() => {
    if (window.__staffroomPerf !== undefined) window.__staffroomPerf.frames = [];
  });

  await page.waitForTimeout(RECORD_MS);

  const perf = await page.evaluate(() => {
    const sink = window.__staffroomPerf;
    if (sink === undefined) return null;
    const sorted = [...sink.frames].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      frames: sink.frames.length,
      p95: sorted[index] ?? 0,
      // 33 is LONG_FRAME_MS. Inlined because this closure is serialised
      // into the page and cannot see anything from this module.
      longFrames: sink.frames.filter((f) => f > 33).length,
      calls: sink.calls,
      triangles: sink.triangles,
    };
  });

  expect(perf, "the probe recorded nothing").not.toBeNull();
  const { frames, p95, longFrames, calls, triangles } = perf as {
    frames: number;
    p95: number;
    longFrames: number;
    calls: number;
    triangles: number;
  };

  // Printed whichever way it goes: a passing run with the numbers in the log is
  // how somebody notices a budget creeping towards its ceiling before it fails.
  // The CI step pipes this into the job summary, which is the whole point.
  // biome-ignore lint/suspicious/noConsole: the numbers are this test's output
  console.log(
    `perf: ${frames} frames, p95 ${p95.toFixed(2)}ms, ${longFrames} over ${LONG_FRAME_MS}ms, ` +
      `${calls} draw calls, ${triangles} triangles, first frame ${firstFrameMs.toFixed(0)}ms`,
  );

  // Everywhere: the scene drew something, and it costs what it should.
  expect(frames, "the scene barely rendered").toBeGreaterThan(MIN_FRAMES);
  expect(calls, "the office costs more to draw than it used to").toBeLessThan(MAX_DRAW_CALLS);
  expect(triangles, "too many triangles for this scene").toBeLessThan(MAX_TRIANGLES);

  // Only where the same machine gives the same answer twice. See the note above
  // the budgets: on CI these are measured and printed, never asserted.
  if (ON_CI) return;

  expect(firstFrameMs, "first frame took too long").toBeLessThan(MAX_FIRST_FRAME_MS);
  expect(p95, "the office is not keeping up with the display").toBeLessThan(MAX_P95_MS);
  expect(longFrames / frames, "too many dropped frames — the scene lurches").toBeLessThan(
    MAX_LONG_FRAME_RATIO,
  );
});
