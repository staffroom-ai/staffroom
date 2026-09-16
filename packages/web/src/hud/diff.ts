/**
 * What changed between one draft and the next.
 *
 * Line-based, and by line rather than by word on purpose: these are drafts of
 * writing, and a word-level diff of a rewritten paragraph is confetti. A reader
 * comparing two versions of an email wants to see which paragraphs moved, not
 * which articles did.
 *
 * The algorithm is a longest common subsequence over lines, computed the plain
 * quadratic way. A deliverable is tens of lines; the clever version would be
 * more code to be wrong in for no difference anybody could feel.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** Bails out on anything big enough to make the quadratic table expensive. */
const MAX_LINES = 2_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const from = before.split("\n");
  const to = after.split("\n");

  if (from.length > MAX_LINES || to.length > MAX_LINES) {
    // Honest rather than slow: the whole of one, then the whole of the other.
    return [
      ...from.map((text) => ({ kind: "removed" as const, text })),
      ...to.map((text) => ({ kind: "added" as const, text })),
    ];
  }

  // lengths[i][j] is the longest run of shared lines in from[i..] and to[j..].
  const lengths: number[][] = Array.from({ length: from.length + 1 }, () =>
    new Array<number>(to.length + 1).fill(0),
  );

  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      const row = lengths[i] as number[];
      const next = lengths[i + 1] as number[];
      row[j] =
        from[i] === to[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < from.length && j < to.length) {
    if (from[i] === to[j]) {
      out.push({ kind: "same", text: from[i] as string });
      i++;
      j++;
      continue;
    }
    const down = (lengths[i + 1] as number[])[j] as number;
    const right = (lengths[i] as number[])[j + 1] as number;
    if (down >= right) {
      out.push({ kind: "removed", text: from[i] as string });
      i++;
    } else {
      out.push({ kind: "added", text: to[j] as string });
      j++;
    }
  }

  while (i < from.length) out.push({ kind: "removed", text: from[i++] as string });
  while (j < to.length) out.push({ kind: "added", text: to[j++] as string });

  return out;
}

/** True when the two versions are the same text, so the toggle can say so. */
export function isUnchanged(lines: DiffLine[]): boolean {
  return lines.every((line) => line.kind === "same");
}

/**
 * "v3, revised from v2".
 *
 * Positions in the chain rather than note ids, because the ids are dates and
 * filenames and the question being answered is "which draft am I looking at".
 */
export function revisionLabel(chain: string[], noteId: string): string | undefined {
  const index = chain.indexOf(noteId);
  if (index === -1 || chain.length < 2) return undefined;
  if (index === 0) return `v1 of ${chain.length}`;
  return `v${index + 1}, revised from v${index}`;
}
