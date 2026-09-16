/**
 * The list view's rules, and the contract it has with the smoke test.
 *
 * The selectors below are shared with e2e/smoke.spec.ts. Renaming one without
 * changing that file would leave the project's only end-to-end check passing
 * against nothing, so they are snapshotted: a rename has to be deliberate.
 */
import { describe, expect, it } from "vitest";
import { Announcer, LIST_ONLY_BELOW, SCENE_DEFAULT_ABOVE, VIEW_KEY, viewFor } from "./ListView.js";

describe("which view to show", () => {
  it("forces the list on a phone, whatever was remembered", () => {
    expect(viewFor(375, "scene")).toBe("list");
    expect(viewFor(LIST_ONLY_BELOW - 1, "scene")).toBe("list");
  });

  it("defaults to the office on a wide screen, ignoring a stale preference", () => {
    expect(viewFor(1440, null)).toBe("scene");
    expect(viewFor(1440, "list")).toBe("scene");
  });

  it("remembers the choice only in the band between the two", () => {
    expect(viewFor(900, "list")).toBe("list");
    expect(viewFor(900, "scene")).toBe("scene");
    expect(viewFor(SCENE_DEFAULT_ABOVE, "list")).toBe("list");
    expect(viewFor(SCENE_DEFAULT_ABOVE + 1, "list")).toBe("scene");
  });

  it("ignores a value that is not a view", () => {
    expect(viewFor(900, "something-else")).toBe("scene");
    expect(viewFor(900, "")).toBe("scene");
  });

  it("keeps the storage key stable", () => {
    expect(VIEW_KEY).toBe("staffroom.view");
  });
});

describe("the announcer", () => {
  it("lets each agent speak once, then holds them for five seconds", () => {
    const announcer = new Announcer();
    expect(announcer.consider("priya", "Priya is working.", 0)).toBe("Priya is working.");
    expect(announcer.consider("priya", "Priya is stuck.", 4_999)).toBeUndefined();
    expect(announcer.consider("priya", "Priya is stuck.", 5_001)).toBe("Priya is stuck.");
  });

  it("throttles per agent, so one busy person does not silence everyone else", () => {
    const announcer = new Announcer();
    announcer.consider("priya", "Priya is working.", 0);
    expect(announcer.consider("dana", "Dana is working.", 10)).toBe("Dana is working.");
  });
});

describe("the selectors the smoke test depends on", () => {
  it("has not changed without someone meaning it to", () => {
    expect({
      row: "agent-<id>",
      rowState: "data-state",
      firstResult: "deliverable-latest",
      resultNamePrefix: "Written by ",
      departmentPicker: { role: "combobox", name: "Department" },
      taskField: { role: "textbox", name: "Task" },
      skipLink: "Skip to list view",
      listTarget: "list-view",
    }).toMatchSnapshot();
  });
});
