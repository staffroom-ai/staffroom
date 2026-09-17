/**
 * Finding a note by what it means rather than by the words in it.
 *
 * Keyword search fails in one specific, common way: the owner asks "what do we
 * charge for a retainer" and the note says "monthly fee". Both are about the
 * same thing and share no words, so full-text search returns nothing and the
 * agent answers from the void. That is the gap this closes.
 *
 * It is off by default, and deliberately so. Turning it on means every note in
 * the business is sent to whoever provides the embedding model — which is a
 * reasonable trade for some owners and unacceptable for others, and not a
 * decision a default should make for them. Ollama runs it on their own machine
 * and nothing leaves; a hosted provider does not.
 *
 * Neither index is thrown away. Keyword search is exact and fast and the right
 * answer when somebody types a customer's name; vector search is the right
 * answer when they describe a thing in their own words. `mode: "hybrid"` runs
 * both and fuses the two rankings, so a note that either method is confident
 * about still surfaces.
 */
import type { EmbeddingProvider } from "./types.js";

/**
 * Chunk size, in tokens, and how much each chunk repeats of the last.
 *
 * Notes are prose, and prose puts the answer and its context in different
 * sentences. A chunk that ends mid-thought embeds as half an idea, so they
 * overlap: 400 with 60 back means a sentence near a boundary appears whole in
 * one of the two chunks either side of it.
 */
export const CHUNK_TOKENS = 400;
export const CHUNK_OVERLAP = 60;

/**
 * Tokens are estimated rather than counted.
 *
 * A real tokeniser is per-model, and this decides where to cut a note, not what
 * to charge for it. Four characters per token is close enough for English prose
 * that the chunks come out the intended size, and being wrong by ten per cent
 * costs nothing — the overlap is what actually protects the boundaries.
 */
const CHARS_PER_TOKEN = 4;

export interface Chunk {
  index: number;
  text: string;
}

/**
 * Splits a note into overlapping chunks, on word boundaries.
 *
 * Cutting mid-word would embed a fragment that means nothing, so the split
 * walks words rather than characters.
 */
export function chunk(text: string, options: { tokens?: number; overlap?: number } = {}): Chunk[] {
  const size = (options.tokens ?? CHUNK_TOKENS) * CHARS_PER_TOKEN;
  const back = (options.overlap ?? CHUNK_OVERLAP) * CHARS_PER_TOKEN;
  const body = text.trim();
  if (body.length === 0) return [];
  if (body.length <= size) return [{ index: 0, text: body }];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < body.length) {
    let end = Math.min(body.length, start + size);

    // Back up to the last space, so a chunk never ends mid-word. Only within a
    // reasonable distance: a note with no spaces at all is cut where it is.
    if (end < body.length) {
      const space = body.lastIndexOf(" ", end);
      if (space > start + size / 2) end = space;
    }

    chunks.push({ index: chunks.length, text: body.slice(start, end).trim() });
    if (end >= body.length) break;

    // The start moves back by the overlap, then forward to a word boundary.
    // Backing up the end was not enough on its own: the next chunk began in the
    // middle of whatever word the overlap happened to land in, and a fragment
    // like "ord24" embeds as nothing at all.
    let next = Math.max(start + 1, end - back);
    const boundary = body.indexOf(" ", next);
    if (boundary !== -1 && boundary < end) next = boundary + 1;
    start = next;
  }

  return chunks;
}

/**
 * How alike two vectors are, between -1 and 1.
 *
 * Cosine rather than distance because embedding models produce vectors whose
 * direction carries the meaning and whose length does not.
 */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }

  const magnitude = Math.sqrt(aa) * Math.sqrt(bb);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/** Vectors are stored as raw float32, which is half the size of JSON and exact. */
export function toBlob(vector: number[]): Buffer {
  const floats = Float32Array.from(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

export function fromBlob(blob: Buffer): Float32Array {
  // Copied rather than viewed: better-sqlite3's buffer is reused between rows,
  // so a view would quietly change under a caller that held onto it.
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

export interface Ranked {
  id: string;
  /** Where in the ranking this came, 1 being best. */
  rank: number;
}

/** The constant from the reciprocal rank fusion paper; 60 is its recommendation. */
export const RRF_K = 60;

/**
 * Merges two rankings into one.
 *
 * Reciprocal rank fusion, because the two searches produce scores that cannot
 * be compared: bm25 is unbounded and lower-is-better, cosine is -1 to 1 and
 * higher-is-better. Normalising them against each other would mean inventing a
 * conversion and then defending it forever. Ranks are comparable by
 * construction, and a note both methods put near the top beats one that either
 * loves alone — which is exactly the behaviour worth having.
 */
export function fuse(lists: Ranked[][], k: number = RRF_K): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (const { id, rank } of list) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

export const EMBED_UNSUPPORTED = "embed_unsupported";

/**
 * Whether this provider can embed at all.
 *
 * `embed` is optional on the adapter interface, and most providers do not have
 * one. Enabling embeddings against a provider that cannot do them is a warning
 * the owner has to see — the office carries on with keyword search rather than
 * refusing to start, but silently doing half of what the config asked for would
 * be worse than either.
 */
export function canEmbed(provider: EmbeddingProvider | undefined): boolean {
  return typeof provider?.embed === "function";
}

export function embedUnsupportedWarning(providerId: string): string {
  return (
    `${providerId} does not do embeddings, so brain.embeddings is not in use and search is keyword only. ` +
    "Ollama can, with a model like nomic-embed-text, and runs on this machine."
  );
}

export interface EmbedIndex {
  notesNeedingEmbedding(model: string): Array<{ id: string; body: string }>;
  putEmbeddings(
    noteId: string,
    model: string,
    chunks: Array<{ index: number; text: string; vector: number[] }>,
  ): void;
  invalidateEmbeddings(model: string): number;
}

export interface EmbedResult {
  notes: number;
  chunks: number;
  /** Vectors thrown away because the model changed. */
  invalidated: number;
  /** Notes that could not be embedded, by id. Named rather than counted. */
  failed: string[];
}

/**
 * How many chunks go to the provider at once.
 *
 * Small enough that one failure loses little and a slow provider still makes
 * visible progress; large enough that a brain of a few hundred notes is not
 * hundreds of round trips.
 */
export const EMBED_BATCH = 32;

/**
 * Embeds everything that needs it.
 *
 * Idempotent, because it is safe to run on every boot: notes already embedded
 * with this model are not sent again, and the first thing it does is throw away
 * anything embedded with a different one.
 *
 * A note that fails is recorded and skipped rather than stopping the run. The
 * office still works with keyword search, and half an embedding index is better
 * than none — the ones that succeeded still answer.
 */
export async function embedNotes(
  index: EmbedIndex,
  provider: EmbeddingProvider,
  model: string,
  options: { signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  const embed = provider.embed;
  if (embed === undefined) {
    throw new Error(embedUnsupportedWarning(provider.id));
  }

  const invalidated = index.invalidateEmbeddings(model);
  const pending = index.notesNeedingEmbedding(model);

  let notes = 0;
  let chunks = 0;
  const failed: string[] = [];

  for (const note of pending) {
    if (options.signal?.aborted === true) break;

    const pieces = chunk(note.body);
    if (pieces.length === 0) continue;

    try {
      const vectors: number[][] = [];
      for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
        const batch = pieces.slice(i, i + EMBED_BATCH);
        vectors.push(
          ...(await embed.call(
            provider,
            batch.map((c) => c.text),
            model,
          )),
        );
      }

      // A provider that answered with the wrong number of vectors has not done
      // what was asked, and pairing them up anyway would file each chunk under
      // the wrong meaning — worse than not embedding the note at all.
      if (vectors.length !== pieces.length) {
        failed.push(note.id);
        continue;
      }

      index.putEmbeddings(
        note.id,
        model,
        pieces.map((piece, i) => ({ ...piece, vector: vectors[i] as number[] })),
      );
      notes += 1;
      chunks += pieces.length;
    } catch {
      failed.push(note.id);
    }
  }

  return { notes, chunks, invalidated, failed };
}
