/**
 * Where the notes go on screen.
 *
 * A force layout, written out rather than pulled in, for two reasons. The graph
 * is a few hundred nodes at most — a business's notes, not a social network — so
 * a general-purpose library would be several times the size of the thing it lays
 * out, in a bundle every visitor downloads. And the layout has to be
 * deterministic: the same brain must draw the same picture every time it opens,
 * or an owner learns the shape of their notes and then finds it rearranged.
 *
 * So there is no randomness anywhere here. Starting positions come from the note
 * id, which means a note lands in the same place today as it did yesterday, and
 * two people looking at the same office see the same thing.
 */
import type { BrainGraphEdge, BrainGraphNode } from "@staffroom/core";

export interface Placed {
  id: string;
  x: number;
  y: number;
  /** Carried through so the drawing does not have to look it up again. */
  node: BrainGraphNode;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  /** More is steadier, fewer is faster. The default settles a studio brain. */
  iterations?: number;
}

const WIDTH = 1000;
const HEIGHT = 700;
const ITERATIONS = 260;

/**
 * How close two notes are allowed to get, before the layout is scaled to fit.
 *
 * Set by the labels rather than the dots: two circles can touch and still be
 * read, but two names on top of each other are one unreadable smear.
 */
const MIN_SEPARATION = 70;

/**
 * How hard the middle pulls.
 *
 * Small on purpose: enough that nothing escapes the picture, not so much that
 * everything piles into the centre and the structure disappears.
 */
const GRAVITY = 0.08;

/**
 * A number from a string, the same every time.
 *
 * FNV-1a: small, fast, and with no state to carry. Not a security hash and not
 * used as one — it exists only so a note starts in the same place twice.
 */
export function hashOf(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** A starting point on a spiral, so nothing begins stacked on anything else. */
function seedPosition(id: string, index: number, count: number): { x: number; y: number } {
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + (hashOf(id) % 628) / 100;
  const radius = 60 + ((hashOf(id) % 1_000) / 1_000) * Math.min(WIDTH, HEIGHT) * 0.35;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Lays the graph out.
 *
 * Plain Fruchterman-Reingold: every node pushes every other apart, every edge
 * pulls its two ends together, and the whole thing cools over the iterations so
 * it settles instead of oscillating. Quadratic in the node count, which is the
 * right trade at this size — the alternative is a quadtree and a lot more code
 * to be wrong in.
 */
export function layout(
  nodes: BrainGraphNode[],
  edges: BrainGraphEdge[],
  options: LayoutOptions = {},
): Placed[] {
  const width = options.width ?? WIDTH;
  const height = options.height ?? HEIGHT;
  const iterations = options.iterations ?? ITERATIONS;

  if (nodes.length === 0) return [];
  const only = nodes[0];
  if (nodes.length === 1 && only !== undefined) {
    return [{ id: only.id, x: width / 2, y: height / 2, node: only }];
  }

  const area = width * height;
  const k = Math.sqrt(area / nodes.length);

  const index = new Map<string, number>();
  const xs = new Float64Array(nodes.length);
  const ys = new Float64Array(nodes.length);

  nodes.forEach((node, i) => {
    index.set(node.id, i);
    const seed = seedPosition(node.id, i, nodes.length);
    xs[i] = seed.x;
    ys[i] = seed.y;
  });

  // Only edges with both ends on screen; anything else pulls on nothing.
  const links = edges
    .map((edge) => ({ from: index.get(edge.from), to: index.get(edge.to) }))
    .filter((l): l is { from: number; to: number } => l.from !== undefined && l.to !== undefined);

  let temperature = Math.min(width, height) / 8;
  const cooling = temperature / (iterations + 1);

  const dx = new Float64Array(nodes.length);
  const dy = new Float64Array(nodes.length);

  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let deltaX = (xs[i] as number) - (xs[j] as number);
        let deltaY = (ys[i] as number) - (ys[j] as number);
        let distance = Math.hypot(deltaX, deltaY);
        if (distance < 0.01) {
          // Two nodes exactly on top of each other have no direction to push in.
          // Nudged apart by their index rather than at random, so the result is
          // still the same on every run.
          deltaX = (i % 7) / 10 + 0.1;
          deltaY = (j % 5) / 10 + 0.1;
          distance = Math.hypot(deltaX, deltaY);
        }
        const force = (k * k) / distance;
        const fx = (deltaX / distance) * force;
        const fy = (deltaY / distance) * force;
        dx[i] = (dx[i] as number) + fx;
        dy[i] = (dy[i] as number) + fy;
        dx[j] = (dx[j] as number) - fx;
        dy[j] = (dy[j] as number) - fy;
      }
    }

    for (const link of links) {
      const deltaX = (xs[link.from] as number) - (xs[link.to] as number);
      const deltaY = (ys[link.from] as number) - (ys[link.to] as number);
      const distance = Math.max(0.01, Math.hypot(deltaX, deltaY));
      // Two notes that link to each other should sit near each other, not on top
      // of each other: below this the labels collide and neither is readable, so
      // the pull stops rather than continuing to close the gap.
      if (distance < MIN_SEPARATION) continue;
      const force = (distance * distance) / k;
      const fx = (deltaX / distance) * force;
      const fy = (deltaY / distance) * force;
      dx[link.from] = (dx[link.from] as number) - fx;
      dy[link.from] = (dy[link.from] as number) - fy;
      dx[link.to] = (dx[link.to] as number) + fx;
      dy[link.to] = (dy[link.to] as number) + fy;
    }

    /*
     * A weak pull toward the middle.
     *
     * Without it a note nobody links to only ever gets pushed, so it drifts to
     * the far edge and never comes back. One escapee is enough to stretch the
     * bounding box the whole picture is then scaled into, which squeezes
     * everything else into a corner — which is exactly what it did.
     */
    for (let i = 0; i < nodes.length; i++) {
      const toCentre = Math.hypot(xs[i] as number, ys[i] as number);
      if (toCentre < 1) continue;
      const pull = GRAVITY * toCentre;
      dx[i] = (dx[i] as number) - ((xs[i] as number) / toCentre) * pull;
      dy[i] = (dy[i] as number) - ((ys[i] as number) / toCentre) * pull;
    }

    for (let i = 0; i < nodes.length; i++) {
      const move = Math.max(0.01, Math.hypot(dx[i] as number, dy[i] as number));
      const capped = Math.min(move, temperature);
      xs[i] = (xs[i] as number) + ((dx[i] as number) / move) * capped;
      ys[i] = (ys[i] as number) + ((dy[i] as number) / move) * capped;
    }

    temperature -= cooling;
  }

  return fitToBox(nodes, xs, ys, width, height);
}

/** Scales and centres the result, so a graph of any size fills the same frame. */
function fitToBox(
  nodes: BrainGraphNode[],
  xs: Float64Array,
  ys: Float64Array,
  width: number,
  height: number,
): Placed[] {
  const margin = 40;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < nodes.length; i++) {
    minX = Math.min(minX, xs[i] as number);
    maxX = Math.max(maxX, xs[i] as number);
    minY = Math.min(minY, ys[i] as number);
    maxY = Math.max(maxY, ys[i] as number);
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);

  // Centred rather than pinned to a corner, so a small graph does not sit in the
  // top left of an empty canvas.
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return nodes.map((node, i) => ({
    id: node.id,
    x: ((xs[i] as number) - minX) * scale + offsetX,
    y: ((ys[i] as number) - minY) * scale + offsetY,
    node,
  }));
}

/**
 * The order Tab walks the graph in.
 *
 * By area then title rather than by position: reading order in a force layout is
 * whatever the physics settled on, which is not an order anybody can predict.
 * The folder a note lives in is something the owner chose, so it is something
 * they can follow.
 */
export function tabOrder(nodes: BrainGraphNode[]): string[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.area !== b.area) return a.area.localeCompare(b.area);
      return a.title.localeCompare(b.title);
    })
    .map((n) => n.id);
}
