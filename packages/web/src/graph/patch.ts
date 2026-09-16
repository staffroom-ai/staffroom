/**
 * Keeping the open graph in step with the brain.
 *
 * The overlay asks for a snapshot once and is patched from there. Re-fetching the
 * whole graph every time somebody saves a note in Obsidian would redraw the
 * picture under the owner's cursor, and a force layout that reruns is a picture
 * that jumps.
 *
 * The rule these follow: a patch only ever replaces what it is about. A note
 * arriving replaces that note and the edges that touch it, and nothing else
 * moves. That is what lets the drawing keep the positions it already worked out.
 */
import type { BrainGraph, BrainGraphEdge, BrainGraphNode } from "@staffroom/core";

function sameEdge(a: BrainGraphEdge, b: BrainGraphEdge): boolean {
  return a.from === b.from && a.to === b.to && a.kind === b.kind;
}

/**
 * A note was written or changed on disk.
 *
 * Its old edges go before the new ones arrive, so renaming a link in a note
 * removes the arrow it used to have rather than leaving both.
 */
export function applyIndexed(
  graph: BrainGraph,
  node: BrainGraphNode,
  edges: BrainGraphEdge[],
): BrainGraph {
  const nodes = graph.nodes.filter((n) => n.id !== node.id);
  nodes.push(node);

  // Edges that touched this note are this message's to restate. Everything else
  // is left exactly as it was.
  const kept = graph.edges.filter((e) => e.from !== node.id && e.to !== node.id);
  for (const edge of edges) {
    if (!kept.some((existing) => sameEdge(existing, edge))) kept.push(edge);
  }

  // A note that was a hole is a note now.
  const withoutHole = nodes.filter((n) => !(n.kind === "missing" && n.title === node.id));

  return {
    generatedAt: graph.generatedAt,
    nodes: withoutHole.sort((a, b) => a.id.localeCompare(b.id)),
    edges: kept,
  };
}

/**
 * A note was deleted.
 *
 * The arrows that pointed at it are repointed at a hole rather than vanishing.
 * A graph that tidied them away would be telling the owner their notes are more
 * connected than they are, which is the one thing it must not do.
 */
export function applyRemoved(
  graph: BrainGraph,
  noteId: string,
  nowMissing: BrainGraphNode | undefined,
  edges: BrainGraphEdge[],
): BrainGraph {
  const nodes = graph.nodes.filter((n) => n.id !== noteId);
  if (nowMissing !== undefined && !nodes.some((n) => n.id === nowMissing.id)) {
    nodes.push(nowMissing);
  }

  const kept = graph.edges.filter((e) => e.from !== noteId && e.to !== noteId);
  for (const edge of edges) {
    if (!kept.some((existing) => sameEdge(existing, edge))) kept.push(edge);
  }

  return {
    generatedAt: graph.generatedAt,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: kept,
  };
}

/**
 * Which notes a search matched, for dimming the rest.
 *
 * The graph is filtered rather than replaced: seeing where the matches sit among
 * everything else is the point of searching in a picture rather than in a list.
 */
export function matchingIds(nodes: BrainGraphNode[], query: string): Set<string> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return new Set(nodes.map((n) => n.id));

  return new Set(
    nodes
      .filter((n) => n.title.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle))
      .map((n) => n.id),
  );
}
