/**
 * Putting a file into the brain, and reading a note's history out of the graph.
 *
 * Both live here rather than in the component because both are the kind of thing
 * that has to be right rather than merely to render: one posts the owner's file
 * with their session token, and the other decides which draft somebody is
 * looking at.
 */
import type { BrainGraph } from "@staffroom/core";

/**
 * Posts a file to the brain, with the session token.
 *
 * Multipart rather than a raw body because the route reads a filename out of it,
 * and the filename is the only thing the browser can say about what this is.
 * Returns a sentence when it failed, so the caller can put it in the feed.
 */
export async function uploadToBrain(
  file: File,
  token: string | undefined,
): Promise<string | undefined> {
  const form = new FormData();
  form.append("file", file, file.name);

  const headers: Record<string, string> = {};
  if (token !== undefined) headers["X-Staffroom-Token"] = token;

  try {
    const response = await fetch("/api/brain/upload", { method: "POST", headers, body: form });
    if (response.ok) return undefined;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `${file.name} could not be added.`;
  } catch {
    return `${file.name} could not be added: the office did not answer.`;
  }
}

/** The revision chain a note is in, read off the graph the office already sent. */
export function chainFor(graph: BrainGraph | undefined, noteId: string): string[] | undefined {
  if (graph === undefined) return undefined;

  // Walk back to the original, then forward, so asking from either end of a
  // chain gives the same answer.
  const revises = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === "revises") revises.set(edge.from, edge.to);
  }
  if (revises.size === 0) return undefined;

  const seen = new Set<string>([noteId]);
  const older: string[] = [];
  let cursor = noteId;
  for (;;) {
    const previous = revises.get(cursor);
    if (previous === undefined || seen.has(previous)) break;
    seen.add(previous);
    older.unshift(previous);
    cursor = previous;
  }

  const newer: string[] = [];
  let tail = noteId;
  for (;;) {
    const next = [...revises.entries()].find(([from, to]) => to === tail && !seen.has(from))?.[0];
    if (next === undefined) break;
    seen.add(next);
    newer.push(next);
    tail = next;
  }

  const chain = [...older, noteId, ...newer];
  return chain.length > 1 ? chain : undefined;
}
