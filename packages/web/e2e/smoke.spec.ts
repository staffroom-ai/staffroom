/**
 * The one end-to-end check: a task goes in, a real deliverable comes out.
 *
 * It drives the list view rather than the canvas, because a test that clicks a
 * WebGL surface tests the canvas. The selectors it uses are the contract in
 * office-ui.md §5, snapshotted in listview.test.ts so a rename fails there first.
 */
import { expect, test } from "@playwright/test";

test("adds a task and sees a deliverable", async ({ page }) => {
  await page.goto(process.env["STAFFROOM_URL"] as string);

  // The list view is the accessible twin these hooks live on. It is reached the
  // way a keyboard user reaches it: the skip control sits off-screen until it has
  // focus, so the first Tab is both how you get there and a check that it really
  // is first in the tab order.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Skip to list view" })).toBeFocused();
  await page.keyboard.press("Enter");

  await page.getByRole("combobox", { name: "Department" }).selectOption("marketing");
  await page.getByRole("textbox", { name: "Task" }).fill("Write a two-line tagline for a bakery");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("agent-copywriter")).toHaveAttribute("data-state", "working", {
    timeout: 10_000,
  });

  // Case-insensitive: the agent titles the note "Bakery tagline", and what
  // matters is that the deliverable is about the thing that was asked for.
  await expect(page.getByTestId("deliverable-latest")).toContainText(/bakery/i, {
    timeout: 25_000,
  });

  await expect(page.getByRole("listitem").filter({ hasText: /Written by Priya/ })).toBeVisible();
});
