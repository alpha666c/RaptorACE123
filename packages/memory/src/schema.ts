/**
 * SQLite schema for the memory store. Applied on first open via IF NOT EXISTS.
 * Search uses LIKE (case-insensitive) for M2 — sql.js's prebuilt WASM omits FTS5.
 * A future milestone can swap to @sqlite.org/sqlite-wasm (FTS5 included) or add
 * embedding-based retrieval; the store's searchFacts signature stays the same.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS facts (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  tags_json    TEXT NOT NULL DEFAULT '[]',
  path         TEXT,
  source       TEXT,
  confidence   REAL NOT NULL DEFAULT 1.0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  project_root TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  project_root TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  summary      TEXT,
  tier         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_message      TEXT NOT NULL,
  assistant_message TEXT,
  tool_calls_json   TEXT NOT NULL DEFAULT '[]',
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cost_usd          REAL,
  model             TEXT,
  task_type         TEXT,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_root, started_at);
CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_root, kind);
`;
