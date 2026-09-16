/**
 * Records the office doing a real piece of work, for the README.
 *
 * Nothing here is staged: it drives the same demo office anyone gets from
 * `npx staffroom`, through the same interface, and records what happens. A hero
 * image of a product that does not behave like that is a promise you then have to
 * keep.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const URL = process.env.URL;
const OUT = process.env.OUT ?? "/tmp/hero";
const WIDTH = 1200;
const HEIGHT = 675;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } },
});
const page = await context.newPage();

/** Typing a character at a time, because watching it appear is the point. */
async function type(selector, text) {
  await page.click(selector);
  for (const ch of text) {
    await page.type(selector, ch, { delay: 0 });
    await page.waitForTimeout(28);
  }
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".taskbar");
await page.waitForTimeout(2200); // 1. the office at rest

await type(".taskbar input", "Write a two-line tagline for a bakery"); // 2. the ask
await page.waitForTimeout(600);
await page.keyboard.press("Enter");

await page.waitForTimeout(4200); // 3 and 4. routed, then written

// 5. the result, in the rail
await page.click('.rail-tab:has-text("Results")').catch(() => {});
await page.waitForTimeout(2600);

// 6. the actual file, read in place
await page.click(".result").catch(() => {});
await page.waitForTimeout(3800);
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);

// 7. back to the office, still yours
await page.click('.rail-tab:has-text("Activity")').catch(() => {});
await page.waitForTimeout(2400);

await context.close();
await browser.close();
console.log(OUT);
