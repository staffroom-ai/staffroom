/**
 * The parts of the brain graph that are logic rather than markup.
 *
 * Two things matter most. The layout has to be deterministic — an owner learns
 * the shape of their own notes, and a picture that rearranges itself between
 * openings is a picture nobody trusts. And every patch has to keep the graph
 * honest about gaps: a deleted note leaves a hole where its arrows pointed,
 * rather than being tidied away into a brain that looks better connected than
 * it is.
 */
import type { BrainGraph, BrainGraphEdge, BrainGraphNode } from "@staffroom/core";
import { describe, expect, it } from "vitest";
import { hashOf, layout, tabOrder } from "./layout.js";
import { applyIndexed, applyRemoved, matchingIds } from "./patch.js";
import { acceptsUpload, describeNode, radiusFor, recentDeliverables, styleFor } from "./style.js";

function node(id: string, overrides: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return {
    id,
    kind: "note",
    title: id,
    area: id.split("/")[0] ?? "",
    writtenBy: "owner",
    trust: "owner",
    pinned: false,
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    wordCount: 100,
    readBy: [],
    ...overrides,
  };
}

function edge(from: string, to: string, kind: BrainGraphEdge["kind"] = "link"): BrainGraphEdge {
  return { from, to, kind };
}

function graph(nodes: BrainGraphNode[], edges: BrainGraphEdge[] = []): BrainGraph {
  return { generatedAt: "2026-01-01T00:00:00.000Z", nodes, edges };
}

describe("the layout", () => {
  const nodes = ["a/one", "a/two", "b/three", "b/four", "c/five"].map((id) => node(id));
  const edges = [edge("a/one", "a/two"), edge("b/three", "b/four")];

  it("draws the same picture every time it opens", () => {
    // No randomness anywhere: an owner learns the shape of their notes, and a
    // picture that moves between openings is one they stop reading.
    const first = layout(nodes, edges, { iterations: 40 });
    const second = layout(nodes, edges, { iterations: 40 });

    expect(first.map((p) => [p.id, Math.round(p.x), Math.round(p.y)])).toEqual(
      second.map((p) => [p.id, Math.round(p.x), Math.round(p.y)]),
    );
  });

  it("keeps everything inside the frame", () => {
    for (const placed of layout(nodes, edges, { width: 800, height: 600, iterations: 60 })) {
      expect(placed.x).toBeGreaterThanOrEqual(0);
      expect(placed.x).toBeLessThanOrEqual(800);
      expect(placed.y).toBeGreaterThanOrEqual(0);
      expect(placed.y).toBeLessThanOrEqual(600);
    }
  });

  it("does not stack two notes on one another", () => {
    const placed = layout(nodes, edges, { iterations: 80 });
    const seen = new Set<string>();
    for (const p of placed) {
      const key = `${Math.round(p.x / 4)}:${Math.round(p.y / 4)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("pulls linked notes closer than unlinked ones", () => {
    const linked = [node("x"), node("y"), node("z")];
    const placed = layout(linked, [edge("x", "y")], { iterations: 200 });
    const at = (id: string) => placed.find((p) => p.id === id) as { x: number; y: number };

    const together = Math.hypot(at("x").x - at("y").x, at("x").y - at("y").y);
    const apart = Math.hypot(at("x").x - at("z").x, at("x").y - at("z").y);
    expect(together).toBeLessThan(apart);
  });

  it("handles a brain with nothing, or one thing, in it", () => {
    expect(layout([], [])).toEqual([]);
    const one = layout([node("only")], [], { width: 400, height: 200 });
    expect(one).toEqual([{ id: "only", x: 200, y: 100, node: expect.anything() }]);
  });

  it("ignores an edge to something that is not on screen", () => {
    // A filtered view can hand us edges whose far end is not drawn.
    expect(() => layout(nodes, [edge("a/one", "not/here")], { iterations: 20 })).not.toThrow();
  });

  it("lays out the studio's seventeen notes fast enough to drag", () => {
    const many = Array.from({ length: 17 }, (_, i) => node(`area-${i % 4}/note-${i}`));
    const links = many.slice(1).map((n, i) => edge((many[i] as BrainGraphNode).id, n.id));

    const started = performance.now();
    layout(many, links);
    const elapsed = performance.now() - started;

    // The acceptance figure is 16 ms a frame during drag, and a drag reuses the
    // settled positions rather than relaying out. This bound is deliberately
    // loose — it is here to catch an accidental order-of-magnitude, not to time
    // the machine it runs on.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("hashOf", () => {
  it("is stable, and different for different ids", () => {
    expect(hashOf("00-about/company")).toBe(hashOf("00-about/company"));
    expect(hashOf("a")).not.toBe(hashOf("b"));
  });
});

describe("tab order", () => {
  it("follows the folders the owner made, not where the physics put things", () => {
    const nodes = [
      node("20-products/b", { title: "B" }),
      node("00-about/z", { title: "Z" }),
      node("00-about/a", { title: "A" }),
    ];
    expect(tabOrder(nodes)).toEqual(["00-about/a", "00-about/z", "20-products/b"]);
  });
});

describe("what a node looks like", () => {
  it("says who wrote it, which is the question the picture answers", () => {
    expect(styleFor(node("a")).fill).toBe("--graph-owner");
    expect(styleFor(node("b", { writtenBy: "agent:copywriter" })).fill).toBe("--graph-agent");
  });

  it("rings a draft, because that is the one thing waiting on the owner", () => {
    expect(styleFor(node("a", { status: "draft" })).ring).toBe("--warning");
    expect(styleFor(node("a", { status: "approved" })).ring).toBeUndefined();
  });

  it("dims template filler, so it is not mistaken for the owner's own writing", () => {
    expect(styleFor(node("a", { kind: "sample" })).dim).toBe(true);
    expect(styleFor(node("a")).dim).toBe(false);
  });

  it("draws a note nobody wrote as an outline", () => {
    const style = styleFor(node("missing:pricing", { kind: "missing" }));
    expect(style.outline).toBe(true);
    expect(style.fill).toBe("transparent");
  });

  it("sizes by length, flattened so one long note is not a planet", () => {
    expect(radiusFor(0)).toBeLessThan(radiusFor(100));
    expect(radiusFor(100)).toBeLessThan(radiusFor(1_000));
    expect(radiusFor(1_000_000)).toBeLessThanOrEqual(16);
  });
});

describe("what a screen reader is told", () => {
  it("carries everything the colour and the ring are saying", () => {
    const text = describeNode(
      node("a", {
        title: "Autumn offer",
        writtenBy: "agent:copywriter",
        status: "draft",
        pinned: true,
        readBy: [{ agentId: "lee", runId: "r", at: "2026-01-01T00:00:00.000Z" }],
      }),
    );

    expect(text).toContain("Autumn offer");
    expect(text).toContain("copywriter");
    expect(text).toContain("draft");
    expect(text).toContain("pinned");
    expect(text).toContain("read once");
  });

  it("says a missing note is missing, rather than describing it as a note", () => {
    expect(describeNode(node("missing:pricing", { kind: "missing", title: "pricing" }))).toContain(
      "no note has been written",
    );
  });
});

describe("the newest work", () => {
  it("is the five most recently changed deliverables", () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      node(`40-deliverables/marketing/n${i}`, {
        kind: "deliverable",
        updated: `2026-01-0${i + 1}T00:00:00.000Z`,
      }),
    );
    const recent = recentDeliverables(nodes);

    expect(recent.size).toBe(5);
    expect(recent.has("40-deliverables/marketing/n7")).toBe(true);
    expect(recent.has("40-deliverables/marketing/n0")).toBe(false);
  });

  it("never counts a note that is not a deliverable", () => {
    expect(recentDeliverables([node("00-about/company")]).size).toBe(0);
  });
});

describe("patching a note in", () => {
  it("replaces the note and the arrows that touch it, and nothing else", () => {
    const before = graph([node("a"), node("b"), node("c")], [edge("a", "b"), edge("b", "c")]);
    const after = applyIndexed(before, node("a", { title: "Renamed" }), [edge("a", "c")]);

    expect(after.nodes.find((n) => n.id === "a")?.title).toBe("Renamed");
    // b to c is not this message's business and must survive untouched.
    expect(after.edges).toContainEqual(edge("b", "c"));
    // a to b was, and is gone now that a no longer links there.
    expect(after.edges).not.toContainEqual(edge("a", "b"));
    expect(after.edges).toContainEqual(edge("a", "c"));
  });

  it("fills in a hole when the note somebody linked to finally exists", () => {
    const before = graph(
      [node("a"), node("missing:pricing", { kind: "missing", title: "pricing" })],
      [edge("a", "missing:pricing")],
    );
    const after = applyIndexed(before, node("pricing"), [edge("a", "pricing")]);

    expect(after.nodes.some((n) => n.kind === "missing")).toBe(false);
    expect(after.nodes.some((n) => n.id === "pricing")).toBe(true);
  });

  it("does not add the same arrow twice", () => {
    const before = graph([node("a"), node("b")], [edge("a", "b")]);
    const after = applyIndexed(before, node("a"), [edge("a", "b")]);
    expect(after.edges.filter((e) => e.from === "a" && e.to === "b")).toHaveLength(1);
  });
});

describe("patching a note out", () => {
  it("leaves a hole where its arrows pointed", () => {
    const before = graph([node("a"), node("b")], [edge("a", "b")]);
    const hole = node("missing:b", { kind: "missing", title: "b" });
    const after = applyRemoved(before, "b", hole, [edge("a", "missing:b")]);

    expect(after.nodes.some((n) => n.id === "b")).toBe(false);
    // Tidying the arrow away would tell the owner their notes are better
    // connected than they are, which is the one thing the graph must not do.
    expect(after.nodes).toContainEqual(hole);
    expect(after.edges).toContainEqual(edge("a", "missing:b"));
  });

  it("just removes it when nothing pointed at it", () => {
    const before = graph([node("a"), node("b")], []);
    const after = applyRemoved(before, "b", undefined, []);

    expect(after.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(after.nodes.some((n) => n.kind === "missing")).toBe(false);
  });
});

describe("searching in the picture", () => {
  const nodes = [
    node("00-about/company", { title: "Northlight Studio" }),
    node("20-products/autumn-retainer", { title: "Autumn retainer" }),
  ];

  it("matches on the title or the id", () => {
    expect(matchingIds(nodes, "autumn")).toEqual(new Set(["20-products/autumn-retainer"]));
    expect(matchingIds(nodes, "00-about")).toEqual(new Set(["00-about/company"]));
  });

  it("matches everything when nothing was typed", () => {
    expect(matchingIds(nodes, "   ").size).toBe(2);
  });

  it("matches nothing rather than everything when nothing fits", () => {
    expect(matchingIds(nodes, "zzz").size).toBe(0);
  });
});

describe("what the upload will take", () => {
  it("accepts the three kinds the brain can use", () => {
    for (const name of ["a.md", "A.MD", "notes.txt", "scan.pdf"]) {
      expect(acceptsUpload(name)).toBe(true);
    }
  });

  it("refuses the rest here, so nobody waits for a round trip to be told", () => {
    for (const name of ["a.exe", "a.sh", "a.docx", "a"]) {
      expect(acceptsUpload(name)).toBe(false);
    }
  });
});
