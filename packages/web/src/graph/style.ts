/**
 * What a node in the graph looks like, and why.
 *
 * Every decision here is about reading the picture at a glance without a legend
 * beside it. The rules the drawing follows:
 *
 *   Colour says who wrote it. That is the question the graph exists to answer —
 *   "how much of this is mine?" — and it is the one an owner asks first when the
 *   office has been running for a month.
 *
 *   A ring says a deliverable is waiting on them. Approval is the only state in
 *   the brain that asks something of the owner, so it is the only one loud
 *   enough to spot from across the picture.
 *
 *   Sample content is dim, and a missing note is an outline. Neither is work the
 *   owner did, and a graph that made template filler look like their own writing
 *   would flatter them into thinking the office knew more than it does.
 *
 * Nothing is carried by colour alone: the node's accessible name says who wrote
 * it, what state it is in, and whether it exists.
 */
import type { BrainGraphNode } from "@staffroom/core";

export interface NodeStyle {
  /** A CSS custom property name, so both themes are handled by the stylesheet. */
  fill: string;
  radius: number;
  /** Set for a deliverable that is not finished with. */
  ring?: string;
  dim: boolean;
  outline: boolean;
}

const RADIUS_MIN = 5;
const RADIUS_MAX = 16;

/** Bigger notes are bigger dots, but flattened so one long note is not a planet. */
export function radiusFor(wordCount: number): number {
  if (wordCount <= 0) return RADIUS_MIN;
  const scaled = RADIUS_MIN + Math.sqrt(wordCount) / 4;
  return Math.min(RADIUS_MAX, scaled);
}

export function styleFor(node: BrainGraphNode): NodeStyle {
  if (node.kind === "missing") {
    return { fill: "transparent", radius: RADIUS_MIN, dim: false, outline: true };
  }

  const fill = node.writtenBy === "owner" ? "--graph-owner" : "--graph-agent";
  const ring =
    node.status === "draft" ? "--warning" : node.status === "rejected" ? "--danger" : undefined;

  return {
    fill,
    radius: radiusFor(node.wordCount),
    ...(ring === undefined ? {} : { ring }),
    dim: node.kind === "sample",
    outline: false,
  };
}

/**
 * The node's accessible name.
 *
 * Long on purpose. A screen reader user moving through the graph with Tab gets
 * this and nothing else, so it has to carry everything the colour, the size and
 * the ring are saying to everybody else.
 */
export function describeNode(node: BrainGraphNode): string {
  if (node.kind === "missing") {
    return `${node.title}: linked to, but no note has been written`;
  }

  const who =
    node.writtenBy === "owner" ? "written by you" : `written by ${node.writtenBy.slice(6)}`;
  const parts = [node.title, who];

  if (node.status !== undefined) parts.push(node.status);
  if (node.pinned) parts.push("pinned, so every agent sees it");
  if (node.kind === "sample") parts.push("sample content");
  if (node.readBy.length > 0) {
    parts.push(`read ${node.readBy.length === 1 ? "once" : `${node.readBy.length} times`}`);
  }

  return parts.join(", ");
}

/**
 * The last five deliverables, which the overlay draws larger.
 *
 * Newest work is what somebody opening the graph is usually looking for, and it
 * is otherwise indistinguishable from work filed a year ago.
 */
export function recentDeliverables(nodes: BrainGraphNode[], count = 5): Set<string> {
  return new Set(
    nodes
      .filter((n) => n.kind === "deliverable")
      .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
      .slice(0, count)
      .map((n) => n.id),
  );
}

/** Files the upload will take. Refused here so nobody waits for a round trip. */
export const UPLOAD_TYPES = [".md", ".txt", ".pdf"] as const;

export const UPLOAD_REFUSED = "Only .md, .txt and .pdf files can be added.";

export function acceptsUpload(filename: string): boolean {
  const lower = filename.toLowerCase();
  return UPLOAD_TYPES.some((ext) => lower.endsWith(ext));
}
