/**
 * The parts of SR-041 that are logic rather than markup.
 *
 * The banner's wording changes per platform, a secret must never be shown whole,
 * and one save of a tool file must not stack cards.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useOfficeStore } from "../store.js";
import { mask } from "./ApprovalCard.js";
import { RESTART_COMMAND, stoppedText } from "./StoppedBanner.js";

describe("the stopped banner", () => {
  it("names the machine and the terminal the owner actually has", () => {
    expect(stoppedText("mac")).toBe("Staffroom has stopped on this Mac. Open Terminal and run:");
    expect(stoppedText("windows")).toBe(
      "Staffroom has stopped on this PC. Open PowerShell and run:",
    );
    expect(stoppedText("linux")).toContain("machine");
  });

  it("offers the command that actually restarts it", () => {
    expect(RESTART_COMMAND).toBe("npx staffroom");
  });
});

describe("mask", () => {
  it("never shows a secret whole", () => {
    const secret = "sk-ant-abcdefghijklmnop";
    expect(mask(secret)).not.toContain("abcdefghijklmnop");
    expect(mask(secret)).toContain("•");
  });

  it("keeps enough of a long value to tell two apart", () => {
    expect(mask("sk-ant-aaaaaaaaaaZZ")).not.toBe(mask("sk-ant-aaaaaaaaaaYY"));
  });

  it("hides a short value outright rather than hinting at it", () => {
    expect(mask("abcd")).toBe("••••");
    expect(mask("ab")).toBe("••••");
  });
});

describe("tool notices", () => {
  beforeEach(() => {
    useOfficeStore.setState({ toolNotices: [] });
  });

  it("keeps one card per file, so a double save does not stack two", () => {
    const store = useOfficeStore.getState();
    store.addToolNotice({ file: "orders.ts", ok: false, message: "Line 12: oops" });
    store.addToolNotice({ file: "orders.ts", ok: true, tools: ["lookup_order"] });

    const notices = useOfficeStore.getState().toolNotices;
    expect(notices).toHaveLength(1);
    expect(notices[0]?.ok).toBe(true);
    expect(notices[0]?.tools).toEqual(["lookup_order"]);
  });

  it("keeps cards for different files side by side", () => {
    const store = useOfficeStore.getState();
    store.addToolNotice({ file: "a.ts", ok: true, tools: ["a"] });
    useOfficeStore.getState().addToolNotice({ file: "b.ts", ok: true, tools: ["b"] });
    expect(useOfficeStore.getState().toolNotices).toHaveLength(2);
  });

  it("dismisses by id", () => {
    useOfficeStore.getState().addToolNotice({ file: "a.ts", ok: true, tools: ["a"] });
    const id = useOfficeStore.getState().toolNotices[0]?.id as number;
    useOfficeStore.getState().dismissToolNotice(id);
    expect(useOfficeStore.getState().toolNotices).toHaveLength(0);
  });

  it("gives every notice a distinct id even after a replacement", () => {
    const store = useOfficeStore.getState();
    store.addToolNotice({ file: "a.ts", ok: true });
    useOfficeStore.getState().addToolNotice({ file: "b.ts", ok: true });
    useOfficeStore.getState().addToolNotice({ file: "a.ts", ok: false, message: "broke" });
    const ids = useOfficeStore.getState().toolNotices.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
