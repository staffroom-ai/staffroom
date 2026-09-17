/**
 * The brain index: a disposable cache over a folder of markdown.
 *
 * "Disposable" is the point. The notes are the truth and live as files the owner
 * owns; this database is only here to make search fast, and deleting it costs
 * nothing but a rebuild. A schema change therefore rebuilds rather than migrates.
 */

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import Database from "better-sqlite3";
import type { BrainConfig } from "../config/config.js";
import type {
  BrainListOptions,
  BrainNote,
  BrainNoteRef,
  BrainReader,
  BrainSearchOptions,
} from "../shared/types.js";
import { cosine, fromBlob, fuse, toBlob } from "./embeddings.js";
import { buildResolver, type Link, linksFrom } from "./links.js";
import { isSkipped, noteIdFor, parseNote } from "./parse.js";
import type {
  BrainNoteRecord,
  BrainSearchHit,
  NoteFrontMatter,
  NoteTrust,
  NoteWarning,
  ParsedNote,
} from "./types.js";

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE notes (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, front_matter TEXT NOT NULL, body TEXT NOT NULL,
  content_hash TEXT NOT NULL, mtime INTEGER NOT NULL, word_count INTEGER NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
  trust TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE notes_fts USING fts5(id UNINDEXED, title, tags, body, tokenize = 'porter unicode61');
CREATE TABLE links (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, resolved INTEGER NOT NULL, PRIMARY KEY (from_id, to_id, kind));
-- One row per chunk, not per note: a note is split so that a paragraph about
-- pricing is not averaged together with one about opening hours. The chunk text
-- is kept so a vector hit can show the part that matched rather than the note's
-- opening line, which is usually its title.
CREATE TABLE embeddings (
  note_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, text TEXT NOT NULL,
  model TEXT NOT NULL, dims INTEGER NOT NULL, vec BLOB NOT NULL,
  PRIMARY KEY (note_id, chunk_index)
);
CREATE INDEX embeddings_by_note ON embeddings(note_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

interface NoteRow {
  id: string;
  path: string;
  title: string;
  front_matter: string;
  body: string;
  weight: number;
  trust: string;
}

function toRef(row: NoteRow, excerpt?: string): BrainNoteRef {
  return {
    id: row.id,
    title: row.title,
    area: row.id.split("/")[0] ?? "",
    ...(excerpt === undefined ? {} : { excerpt }),
  };
}

export interface BrainIndexOptions {
  /** Absolute path to the index file. Outside brain/, because it is a cache. */
  indexFile: string;
  config?: Partial<BrainConfig>;
  onWarning?: (warning: NoteWarning) => void;
}

export class BrainIndex {
  private readonly db: Database.Database;
  private readonly brainDir: string;
  private readonly onWarning: ((w: NoteWarning) => void) | undefined;
  /**
   * Added after the index is open, unlike the constructor's `onWarning`.
   *
   * The office builds its brain before the server exists, and the server is what
   * turns a warning into something the owner can see. Without this the office
   * would have to be told about the socket at construction, which is backwards.
   */
  private readonly watchers = new Set<(w: NoteWarning) => void>();

  private constructor(brainDir: string, options: BrainIndexOptions) {
    this.brainDir = brainDir;
    this.onWarning = options.onWarning;
    this.db = new Database(options.indexFile);
    this.db.pragma("journal_mode = WAL");
    this.prepareSchema();
  }

  static open(brainDir: string, options: BrainIndexOptions): BrainIndex {
    const index = new BrainIndex(brainDir, options);
    index.rebuild();
    return index;
  }

  private prepareSchema(): void {
    const existing = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get() as { name: string } | undefined;

    if (existing !== undefined) {
      const version = (
        this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
          | { value: string }
          | undefined
      )?.value;
      if (version === String(SCHEMA_VERSION)) return;
      // A cache never migrates. Drop it and read the files again.
      for (const table of ["notes", "notes_fts", "links", "embeddings", "meta"]) {
        this.db.exec(`DROP TABLE IF EXISTS ${table}`);
      }
    }

    this.db.exec(SCHEMA);
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)")
      .run(String(SCHEMA_VERSION));
  }

  /** Walks the folder and reindexes anything whose hash or mtime moved. */
  rebuild(): { indexed: number; removed: number } {
    const files = this.walk(this.brainDir);
    const parsed: ParsedNote[] = [];

    for (const path of files) {
      const note = this.read(path);
      if (note !== undefined) parsed.push(note);
    }

    const resolver = buildResolver(parsed);
    const seen = new Set(parsed.map((n) => n.id));

    const insertNote = this.db.prepare(
      `INSERT OR REPLACE INTO notes (id, path, title, front_matter, body, content_hash, mtime, word_count, weight, trust, sample)
       VALUES (@id, @path, @title, @frontMatter, @body, @contentHash, @mtime, @wordCount, @weight, @trust, @sample)`,
    );
    const insertFts = this.db.prepare(
      "INSERT INTO notes_fts (id, title, tags, body) VALUES (@id, @title, @tags, @body)",
    );
    const clearFts = this.db.prepare("DELETE FROM notes_fts WHERE id = ?");
    const clearLinks = this.db.prepare("DELETE FROM links WHERE from_id = ?");
    const insertLink = this.db.prepare(
      "INSERT OR REPLACE INTO links (from_id, to_id, kind, resolved) VALUES (?, ?, ?, ?)",
    );

    const write = this.db.transaction((notes: ParsedNote[]) => {
      for (const note of notes) {
        const mtime = statSync(note.path).mtimeMs;
        insertNote.run({
          id: note.id,
          path: note.path,
          title: note.title,
          frontMatter: JSON.stringify(note.frontMatter),
          body: note.body,
          contentHash: note.contentHash,
          mtime,
          wordCount: note.wordCount,
          weight: note.weight,
          trust: note.trust,
          sample: note.frontMatter.sample === true ? 1 : 0,
        });
        clearFts.run(note.id);
        insertFts.run({
          id: note.id,
          title: note.title,
          tags: (note.frontMatter.tags ?? []).join(" "),
          body: note.body,
        });
        clearLinks.run(note.id);
        for (const link of linksFrom(note, resolver)) {
          insertLink.run(link.from, link.to, link.kind, link.resolved ? 1 : 0);
        }
      }
    });
    write(parsed);

    // Anything no longer on disk leaves the index with it.
    const known = this.db.prepare("SELECT id FROM notes").all() as Array<{ id: string }>;
    let removed = 0;
    for (const { id } of known) {
      if (!seen.has(id)) {
        this.removeNote(id);
        removed++;
      }
    }

    return { indexed: parsed.length, removed };
  }

  private walk(dir: string): string[] {
    const out: string[] = [];
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(this.brainDir, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!isSkipped(`${rel}/x.md`)) out.push(...this.walk(full));
        continue;
      }
      if (!isSkipped(rel)) out.push(full);
    }
    return out;
  }

  private read(path: string): ParsedNote | undefined {
    const rel = relative(this.brainDir, path).split(sep).join("/");
    const note = parseNote({
      id: noteIdFor(rel),
      path,
      text: readFileSync(path, "utf8"),
      birthTime: statSync(path).birthtime,
    });
    // A note marked private is not skipped from the index, it is absent from it.
    if (note.frontMatter.private === true) return undefined;
    for (const warning of note.warnings) this.warn(warning);
    return note;
  }

  /** Returns an unsubscribe, so a closed socket stops being told. */
  subscribeWarnings(fn: (warning: NoteWarning) => void): () => void {
    this.watchers.add(fn);
    return () => {
      this.watchers.delete(fn);
    };
  }

  private warn(warning: NoteWarning): void {
    this.onWarning?.(warning);
    for (const watcher of this.watchers) {
      try {
        watcher(warning);
      } catch {
        // A listener that throws is not a reason to stop indexing the note.
      }
    }
  }

  /** The note id a file in this brain would have. */
  idFor(path: string): string {
    return noteIdFor(relative(this.brainDir, path).split(sep).join("/"));
  }

  reindexFile(path: string): void {
    const note = this.read(path);
    if (note === undefined) {
      this.removeNote(noteIdFor(relative(this.brainDir, path).split(sep).join("/")));
      return;
    }
    this.rebuild();
  }

  removeFile(path: string): void {
    this.removeNote(noteIdFor(relative(this.brainDir, path).split(sep).join("/")));
  }

  private removeNote(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM notes_fts WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM links WHERE from_id = ?").run(id);
    })();
  }

  /** FTS5 bm25 with title weighted over tags over body, scaled by the note's weight. */
  /**
   * Replaces a note's chunks with freshly embedded ones.
   *
   * Everything for the note goes first, so a note that shrank does not leave
   * chunks behind that nothing points at any more.
   */
  putEmbeddings(
    noteId: string,
    model: string,
    chunks: Array<{ index: number; text: string; vector: number[] }>,
  ): void {
    const write = this.db.transaction(() => {
      this.db.prepare("DELETE FROM embeddings WHERE note_id = ?").run(noteId);
      const insert = this.db.prepare(
        `INSERT INTO embeddings (note_id, chunk_index, text, model, dims, vec)
         VALUES (@noteId, @chunkIndex, @text, @model, @dims, @vec)`,
      );
      for (const c of chunks) {
        insert.run({
          noteId,
          chunkIndex: c.index,
          text: c.text,
          model,
          dims: c.vector.length,
          vec: toBlob(c.vector),
        });
      }
    });
    write();
  }

  /** How many chunks are embedded, and with which model. */
  embeddingStatus(): { chunks: number; models: string[] } {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM embeddings").get() as { n: number };
    const models = (
      this.db.prepare("SELECT DISTINCT model FROM embeddings").all() as Array<{ model: string }>
    ).map((r) => r.model);
    return { chunks: row.n, models };
  }

  /**
   * Throws away every vector not made by this model.
   *
   * Two models' vectors are not comparable — different dimensions, and even at
   * the same size they describe different spaces — so a mixed table would
   * return confident nonsense. Changing the model in config.yaml therefore
   * costs a re-embed, and that is the honest price rather than a bug.
   */
  invalidateEmbeddings(model: string): number {
    return this.db.prepare("DELETE FROM embeddings WHERE model != ?").run(model).changes;
  }

  /** Notes with no chunks for this model, which is what needs embedding next. */
  notesNeedingEmbedding(model: string): Array<{ id: string; body: string }> {
    return this.db
      .prepare(
        `SELECT n.id, n.body FROM notes n
         WHERE NOT EXISTS (
           SELECT 1 FROM embeddings e WHERE e.note_id = n.id AND e.model = ?
         )
         ORDER BY n.id`,
      )
      .all(model) as Array<{ id: string; body: string }>;
  }

  /**
   * The nearest chunks to a query vector, best first.
   *
   * Scanned rather than indexed. A brain is thousands of chunks, not millions,
   * and a full scan of ten thousand 768-dimension vectors is a few
   * milliseconds — where a vector index would be a second dependency, a second
   * file format and a second thing to corrupt.
   */
  nearest(vector: number[], limit: number): Array<{ noteId: string; text: string; score: number }> {
    const rows = this.db.prepare("SELECT note_id, text, vec FROM embeddings").all() as Array<{
      note_id: string;
      text: string;
      vec: Buffer;
    }>;

    const best = new Map<string, { noteId: string; text: string; score: number }>();
    for (const row of rows) {
      const score = cosine(vector, fromBlob(row.vec));
      const seen = best.get(row.note_id);
      // The best chunk stands for the note. A note is one result to the owner,
      // and the chunk that matched is the excerpt worth showing them.
      if (seen === undefined || score > seen.score) {
        best.set(row.note_id, { noteId: row.note_id, text: row.text, score });
      }
    }

    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Keyword and vector together, fused.
   *
   * The query vector is the caller's job, because embedding it is a network
   * call and the index does not make those. Given one, both searches run and
   * the rankings are merged; without one this is plain keyword search, which is
   * what happens when embeddings are off or the provider cannot do them.
   *
   * A note found only by meaning keeps the chunk that matched as its excerpt.
   * Showing the note's first line instead would leave the owner wondering why
   * it came back at all.
   */
  hybridSearch(
    query: string,
    queryVector: number[] | undefined,
    options: BrainSearchOptions & { department?: string } = {},
  ): BrainSearchHit[] {
    const limit = options.limit ?? 8;
    const keyword = this.search(query, { ...options, limit: limit * 2 });
    if (queryVector === undefined || queryVector.length === 0) return keyword.slice(0, limit);

    const vector = this.nearest(queryVector, limit * 2);
    if (vector.length === 0) return keyword.slice(0, limit);

    const fused = fuse([
      keyword.map((hit, i) => ({ id: hit.id, rank: i + 1 })),
      vector.map((hit, i) => ({ id: hit.noteId, rank: i + 1 })),
    ]);

    const byId = new Map(keyword.map((hit) => [hit.id, hit]));
    const chunkFor = new Map(vector.map((hit) => [hit.noteId, hit.text]));
    const hits: BrainSearchHit[] = [];

    for (const { id, score } of fused) {
      if (hits.length >= limit) break;

      const known = byId.get(id);
      if (known !== undefined) {
        hits.push({ ...known, score });
        continue;
      }

      // Found only by meaning, so the row has to be read to be returned.
      if (options.area !== undefined && !id.startsWith(`${options.area}/`)) continue;
      const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as
        | NoteRow
        | undefined;
      if (row === undefined) continue;

      hits.push({
        id,
        title: row.title,
        score,
        excerpt: (chunkFor.get(id) ?? row.body).slice(0, 240).trim(),
        frontMatter: JSON.parse(row.front_matter) as NoteFrontMatter,
      });
    }

    return hits;
  }

  search(
    query: string,
    options: BrainSearchOptions & { department?: string } = {},
  ): BrainSearchHit[] {
    const limit = options.limit ?? 8;
    const cleaned = query.trim();
    if (cleaned.length === 0) return [];

    let rows: Array<NoteRow & { rank: number }>;
    try {
      rows = this.db
        .prepare(
          `SELECT n.*, bm25(notes_fts, 0.0, 4.0, 2.0, 1.0) AS rank
           FROM notes_fts JOIN notes n ON n.id = notes_fts.id
           WHERE notes_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(toMatchQuery(cleaned), limit * 4) as Array<NoteRow & { rank: number }>;
    } catch {
      // A query FTS5 cannot parse is the owner's words, not an error to show them.
      return [];
    }

    return rows
      .map((row) => {
        const frontMatter = JSON.parse(row.front_matter) as NoteFrontMatter;
        // bm25 returns lower-is-better; invert so a bigger score is a better hit.
        let score = (1 / (1 + Math.abs(row.rank))) * row.weight;
        if (options.department !== undefined) {
          const inDepartment =
            row.id.startsWith(`40-deliverables/${options.department}/`) ||
            frontMatter.department === options.department;
          if (inDepartment) score *= 1.5;
        }
        return {
          id: row.id,
          title: row.title,
          score,
          excerpt: excerptFor(row.body, cleaned),
          frontMatter,
        };
      })
      .filter((hit) => (options.area === undefined ? true : hit.id.startsWith(`${options.area}/`)))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  read_(id: string): BrainNote | null {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | undefined;
    if (row === undefined) return null;
    const frontMatter = JSON.parse(row.front_matter) as NoteFrontMatter;
    return {
      ...toRef(row),
      body: row.body,
      tags: frontMatter.tags ?? [],
      ...(frontMatter.written_by === undefined ? {} : { writtenBy: frontMatter.written_by }),
      createdAt: frontMatter.created,
    };
  }

  list(options: BrainListOptions = {}): BrainNoteRef[] {
    const rows = (
      options.area === undefined
        ? this.db.prepare("SELECT * FROM notes ORDER BY id LIMIT ?").all(options.limit ?? 100)
        : this.db
            .prepare("SELECT * FROM notes WHERE id LIKE ? ORDER BY id LIMIT ?")
            .all(`${options.area}/%`, options.limit ?? 100)
    ) as NoteRow[];
    return rows.map((r) => toRef(r));
  }

  /** Notes marked pinned, which every agent sees. Archived notes never qualify. */
  pinned(): BrainNoteRef[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM notes WHERE json_extract(front_matter, '$.pinned') = 1 AND weight >= 1.0 ORDER BY id",
      )
      .all() as NoteRow[];
    return rows.map((r) => toRef(r));
  }

  /**
   * Everything the graph needs about a note, in one pass.
   *
   * `list()` returns the thin ref the tools hand to an agent. The graph needs
   * what the owner wrote about the note — when, by whom, pinned or not, its
   * status — and pulling that one note at a time over a few hundred notes is a
   * query per node for no reason.
   */
  records(): BrainNoteRecord[] {
    const rows = this.db
      .prepare("SELECT id, title, front_matter, mtime, word_count, trust, sample FROM notes")
      .all() as Array<{
      id: string;
      title: string;
      front_matter: string;
      mtime: number;
      word_count: number;
      trust: string;
      sample: number;
    }>;

    return rows.map((row) => {
      let frontMatter: NoteFrontMatter;
      try {
        frontMatter = JSON.parse(row.front_matter) as NoteFrontMatter;
      } catch {
        // A note is never dropped for bad metadata; it just has less of it.
        frontMatter = { title: row.title, created: "", written_by: "owner" };
      }
      return {
        id: row.id,
        title: row.title,
        frontMatter,
        mtime: row.mtime,
        wordCount: row.word_count,
        trust: row.trust as NoteTrust,
        sample: row.sample === 1,
      };
    });
  }

  links(): Link[] {
    const rows = this.db.prepare("SELECT * FROM links").all() as Array<{
      from_id: string;
      to_id: string;
      kind: string;
      resolved: number;
    }>;
    return rows.map((r) => ({
      from: r.from_id,
      to: r.to_id,
      kind: r.kind as Link["kind"],
      resolved: r.resolved === 1,
    }));
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
  }

  /** The read-only handle the tool registry puts on every ToolContext. */
  reader(): BrainReader {
    return {
      search: (query, opts) =>
        Promise.resolve(
          this.search(query, opts ?? {}).map((hit) => ({
            id: hit.id,
            title: hit.title,
            area: hit.id.split("/")[0] ?? "",
            excerpt: hit.excerpt,
          })),
        ),
      read: (id) => Promise.resolve(this.read_(id)),
      list: (opts) => Promise.resolve(this.list(opts ?? {})),
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Quotes each term so punctuation in the owner's words cannot break the query. */
function toMatchQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, "").trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"`).join(" OR ");
}

function excerptFor(body: string, query: string): string {
  const firstTerm = query.split(/\s+/)[0]?.toLowerCase() ?? "";
  const at = body.toLowerCase().indexOf(firstTerm);
  const start = at === -1 ? 0 : Math.max(0, at - 60);
  const text = body
    .slice(start, start + 200)
    .replace(/\s+/g, " ")
    .trim();
  return start > 0 ? `...${text}` : text;
}
