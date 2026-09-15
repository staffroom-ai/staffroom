-- Runs and their events. Events are the source of truth; the runs row is a cache
-- of the latest state so the office can list runs without replaying every event.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  department TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  parent_run_id TEXT,
  routine_id TEXT,
  sample INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL
);

CREATE TABLE run_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL   -- JSON of RunEvent, already redacted
);

CREATE INDEX run_events_by_run ON run_events(run_id, seq);
CREATE INDEX run_events_by_type ON run_events(type, seq);
CREATE INDEX runs_by_agent ON runs(agent_id, created_at);
