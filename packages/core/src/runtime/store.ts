/**
 * The run log: an append-only event store over SQLite.
 *
 * Three things shape this file. Events are redacted on the way in, so a secret
 * never reaches the disk rather than being filtered on the way out. Chunk events
 * are batched, because a streaming reply produces hundreds a second and one
 * transaction each would make the office stutter, but subscribers still see them
 * immediately so the text appears as it arrives. And the `runs` row is maintained
 * in the same transaction as the event that changes it, so a crash cannot leave a
 * run marked running forever.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { redactSecrets } from "../redact.js";
import type {
  Deliverable,
  NewRun,
  PendingApproval,
  Run,
  RunEvent,
  RunEventEnvelope,
  RunListFilter,
  RunStore,
} from "./events.js";

/**
 * Bumped for every additive migration in `migrations/`.
 *
 * The run log is append-only history, so migrations here only ever add: a
 * column an older build did not write is null for the rows it wrote, which is
 * what every reader of this file is expected to handle.
 */
const SCHEMA_VERSION = 2;
const CHUNK_FLUSH_MS = 100;

/**
 * Where the .sql lives depends on how core is being run. From source it sits
 * beside this file; in the published bundle everything is flattened to dist/, so
 * it sits one level up. Both are tried rather than assuming either.
 */
/** In order. The index of a file is the version it upgrades from. */
const MIGRATIONS = ["001-initial.sql", "002-run-label.sql"];

function findMigrations(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "migrations"), join(here, "..", "migrations")]) {
    if (existsSync(join(candidate, "001-initial.sql"))) return candidate;
  }
  throw new Error(
    "Staffroom cannot find its database migrations. This is a packaging bug; please report it.",
  );
}

interface RunRow {
  id: string;
  kind: string;
  agent_id: string;
  department: string;
  model: string;
  prompt: string;
  label: string | null;
  parent_run_id: string | null;
  routine_id: string | null;
  sample: number;
  status: string;
  created_at: number;
  finished_at: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

interface EventRow {
  seq: number;
  run_id: string;
  at: number;
  payload: string;
}

function toRun(row: RunRow): Run {
  const slash = row.model.indexOf("/");
  return {
    id: row.id,
    kind: row.kind as Run["kind"],
    agentId: row.agent_id,
    department: row.department,
    model: { provider: row.model.slice(0, slash), model: row.model.slice(slash + 1) },
    prompt: row.prompt,
    label: row.label,
    parentRunId: row.parent_run_id,
    routineId: row.routine_id,
    sample: row.sample === 1,
    status: row.status as Run["status"],
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    costUsd: row.cost_usd,
  };
}

function toEnvelope(row: EventRow): RunEventEnvelope {
  return {
    seq: row.seq,
    runId: row.run_id,
    at: row.at,
    event: JSON.parse(row.payload) as RunEvent,
  };
}

export interface SqliteRunStoreOptions {
  /** Milliseconds to batch chunk writes. 0 writes every chunk immediately, for tests. */
  chunkFlushMs?: number;
}

export class SqliteRunStore implements RunStore {
  private readonly db: Database.Database;
  private readonly subscribers = new Set<(e: RunEventEnvelope) => void>();
  private readonly chunkFlushMs: number;
  private pendingChunks: Array<{ runId: string; at: number; event: RunEvent }> = [];
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(file: string, options: SqliteRunStoreOptions = {}) {
    this.chunkFlushMs = options.chunkFlushMs ?? CHUNK_FLUSH_MS;
    this.db = new Database(file);
    // WAL lets the office read while a run writes, which is the whole point of
    // being able to open a second connection for replay.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    const row = this.db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
      | { version: number }
      | undefined;

    const dir = findMigrations();

    if (row === undefined) {
      for (const step of MIGRATIONS) this.db.exec(readFileSync(join(dir, step), "utf8"));
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
      return;
    }

    if (row.version > SCHEMA_VERSION) {
      // Written by a newer Staffroom. Guessing at a format we do not know would
      // be worse than saying so.
      throw new Error(
        `runs.sqlite was written by schema version ${row.version}, this build expects ${SCHEMA_VERSION}. ` +
          "Update Staffroom, or move the file aside; it is a log, not configuration.",
      );
    }

    // Additive only, so an older log is brought forward rather than moved aside:
    // this file is the owner's history of everything their office has done.
    for (let version = row.version; version < SCHEMA_VERSION; version++) {
      const step = MIGRATIONS[version];
      if (step === undefined) break;
      this.db.exec(readFileSync(join(dir, step), "utf8"));
    }
    this.db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  create(run: NewRun): Promise<Run> {
    const full: Run = {
      label: null,
      ...run,
      status: "queued",
      finishedAt: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: null,
    };
    this.db
      .prepare(
        `INSERT INTO runs (id, kind, agent_id, department, model, prompt, label, parent_run_id, routine_id, sample, status, created_at)
         VALUES (@id, @kind, @agentId, @department, @model, @prompt, @label, @parentRunId, @routineId, @sample, @status, @createdAt)`,
      )
      .run({
        id: full.id,
        kind: full.kind,
        agentId: full.agentId,
        department: full.department,
        model: `${full.model.provider}/${full.model.model}`,
        prompt: full.prompt,
        label: full.label ?? null,
        parentRunId: full.parentRunId,
        routineId: full.routineId,
        sample: full.sample ? 1 : 0,
        status: full.status,
        createdAt: full.createdAt,
      });
    return Promise.resolve(full);
  }

  /** Redacts, writes, updates the run row and notifies, in that order. */
  /**
   * `at` is for replaying history that already happened — a template's sample
   * run, say. Everything the office does itself leaves it out and gets now,
   * which is the only honest answer for something happening as it is written.
   */
  append(runId: string, event: RunEvent, at = Date.now()): Promise<RunEventEnvelope> {
    const clean = redactSecrets(event);

    if (clean.type === "chunk" && this.chunkFlushMs > 0) {
      // Deferred to disk, but the subscriber sees it now so text streams.
      this.pendingChunks.push({ runId, at, event: clean });
      this.scheduleFlush();
      const envelope: RunEventEnvelope = { seq: -1, runId, at, event: clean };
      this.notify(envelope);
      return Promise.resolve(envelope);
    }

    // Anything that is not a chunk may change the run row, so flush first to keep
    // the sequence honest.
    this.flush();
    const envelope = this.writeOne(runId, at, clean);
    this.notify(envelope);
    return Promise.resolve(envelope);
  }

  private writeOne(runId: string, at: number, event: RunEvent): RunEventEnvelope {
    const write = this.db.transaction(() => {
      const info = this.db
        .prepare("INSERT INTO run_events (run_id, type, at, payload) VALUES (?, ?, ?, ?)")
        .run(runId, event.type, at, JSON.stringify(event));
      this.applyToRun(runId, at, event);
      return Number(info.lastInsertRowid);
    });
    return { seq: write(), runId, at, event };
  }

  /** Keeps the runs row in step with the event that just landed. */
  private applyToRun(runId: string, at: number, event: RunEvent): void {
    switch (event.type) {
      case "started":
        this.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId);
        break;
      case "approval_needed":
        this.db.prepare("UPDATE runs SET status = 'waiting_approval' WHERE id = ?").run(runId);
        break;
      case "approval_resolved":
        this.db
          .prepare(
            "UPDATE runs SET status = 'running' WHERE id = ? AND status = 'waiting_approval'",
          )
          .run(runId);
        break;
      case "done":
        this.db
          .prepare(
            `UPDATE runs SET status = 'done', finished_at = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?
             WHERE id = ?`,
          )
          .run(at, event.usage.inputTokens, event.usage.outputTokens, event.costUsd, runId);
        break;
      case "failed":
        this.db
          .prepare("UPDATE runs SET status = 'failed', finished_at = ? WHERE id = ?")
          .run(at, runId);
        break;
      default:
        break;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.chunkFlushMs);
    this.flushTimer.unref?.();
  }

  /** Writes every buffered chunk in one transaction. Safe to call at any time. */
  flush(): void {
    if (this.pendingChunks.length === 0) return;
    const batch = this.pendingChunks;
    this.pendingChunks = [];
    const insert = this.db.prepare(
      "INSERT INTO run_events (run_id, type, at, payload) VALUES (?, ?, ?, ?)",
    );
    this.db.transaction(() => {
      for (const c of batch) insert.run(c.runId, c.event.type, c.at, JSON.stringify(c.event));
    })();
  }

  private notify(envelope: RunEventEnvelope): void {
    for (const fn of this.subscribers) fn(envelope);
  }

  async *events(runId: string): AsyncIterable<RunEventEnvelope> {
    this.flush();
    const rows = this.db
      .prepare("SELECT seq, run_id, at, payload FROM run_events WHERE run_id = ? ORDER BY seq")
      .all(runId) as EventRow[];
    for (const row of rows) yield toEnvelope(row);
  }

  async *since(seq: number): AsyncIterable<RunEventEnvelope> {
    this.flush();
    const rows = this.db
      .prepare("SELECT seq, run_id, at, payload FROM run_events WHERE seq > ? ORDER BY seq")
      .all(seq) as EventRow[];
    for (const row of rows) yield toEnvelope(row);
  }

  get(runId: string): Promise<Run | null> {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
    return Promise.resolve(row === undefined ? null : toRun(row));
  }

  list(filter: RunListFilter = {}): Promise<Run[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => "?").join(",")})`);
      params.push(...filter.status);
    }
    if (filter.kind?.length) {
      where.push(`kind IN (${filter.kind.map(() => "?").join(",")})`);
      params.push(...filter.kind);
    }
    if (filter.agentId !== undefined) {
      where.push("agent_id = ?");
      params.push(filter.agentId);
    }
    const sql =
      `SELECT * FROM runs${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}` +
      ` ORDER BY created_at DESC LIMIT ?`;
    params.push(filter.limit ?? 50);
    return Promise.resolve((this.db.prepare(sql).all(...params) as RunRow[]).map(toRun));
  }

  /**
   * The newest real deliverable for an agent. Route runs are skipped because they
   * produce no work of their own, and so are deliverables never written to the
   * brain, because "revise" has nothing to revise from those.
   */
  lastDeliverable(agentId: string): Promise<{ run: Run; deliverable: Deliverable } | null> {
    this.flush();
    const row = this.db
      .prepare(
        `SELECT e.payload AS payload, r.* FROM run_events e
         JOIN runs r ON r.id = e.run_id
         WHERE e.type = 'done' AND r.agent_id = ? AND r.kind != 'route'
         ORDER BY e.seq DESC`,
      )
      .all(agentId) as Array<RunRow & { payload: string }>;

    for (const candidate of row) {
      const event = JSON.parse(candidate.payload) as Extract<RunEvent, { type: "done" }>;
      if (event.deliverable.noteId === null) continue;
      return Promise.resolve({ run: toRun(candidate), deliverable: event.deliverable });
    }
    return Promise.resolve(null);
  }

  /** approval_needed events with no approval_resolved sibling. */
  pendingApprovals(): Promise<PendingApproval[]> {
    this.flush();
    const needed = this.db
      .prepare(
        "SELECT seq, run_id, at, payload FROM run_events WHERE type = 'approval_needed' ORDER BY seq",
      )
      .all() as EventRow[];
    const resolved = new Set(
      (
        this.db
          .prepare("SELECT payload FROM run_events WHERE type = 'approval_resolved'")
          .all() as Array<{
          payload: string;
        }>
      ).map((r) => (JSON.parse(r.payload) as { approvalId: string }).approvalId),
    );

    return Promise.resolve(
      needed
        .map((row) => ({ ...(JSON.parse(row.payload) as PendingApproval), runId: row.run_id }))
        .filter((a) => !resolved.has(a.approvalId)),
    );
  }

  /**
   * Removes the runs that came with the template, and their events.
   *
   * The only thing in this file anybody is allowed to delete. Everything else
   * here is the owner's own history and is kept forever; these are somebody
   * else's, shipped so the office had something to show on the first morning.
   *
   * Anything pending is written out first, so a chunk still sitting in the
   * buffer cannot land after the delete and leave an event with no run.
   */
  deleteSamples(): Promise<number> {
    this.flush();
    const removed = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE sample = 1)")
        .run();
      return this.db.prepare("DELETE FROM runs WHERE sample = 1").run().changes;
    })();
    return Promise.resolve(removed);
  }

  subscribe(fn: (e: RunEventEnvelope) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  close(): void {
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
    this.flush();
    this.db.close();
  }
}

export const newRunId = (): string => `run_${ulid()}`;
export const newApprovalId = (): string => `apr_${ulid()}`;
