-- Esquema SQLite de QUA (§03).
--
-- El daemon escribe; el MCP lee en paralelo. De ahí WAL: permite lectores concurrentes
-- mientras `quad` sigue apendeando (§01).
--
-- Este archivo es el contrato de la tarea F0. El resto de `qua-core` (ingest, asr,
-- correlate, render) lo implementa la tarea B1.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  status       TEXT,
  project      TEXT,
  started_at   TEXT,
  duration_ms  INTEGER,
  issue_count  INTEGER,
  dir          TEXT,
  git_sha      TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id           TEXT PRIMARY KEY,
  session_id   TEXT REFERENCES sessions(id),
  t            INTEGER,
  text         TEXT,
  category     TEXT,
  severity     TEXT,
  confidence   REAL,
  anchor_kind  TEXT,
  sel          TEXT,
  url          TEXT,
  src_file     TEXT,
  src_line     INTEGER,
  exported_to  TEXT,
  json         TEXT
);

-- Lo que consulta `qua_issues_pending` del MCP (§10): pendientes primero, más confiables arriba.
CREATE INDEX IF NOT EXISTS idx_pending ON issues(exported_to, confidence DESC);

-- Búsqueda FTS5 de `qua_issues_search` (§10). Tabla externa: el contenido vive en `issues`.
CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
  text,
  content=issues,
  content_rowid=rowid
);

-- Triggers de sincronización del índice externo. Sin esto, `issues_fts` queda vacía:
-- una tabla FTS5 con `content=` no se puebla sola.
CREATE TRIGGER IF NOT EXISTS issues_fts_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issues_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS issues_fts_ad AFTER DELETE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS issues_fts_au AFTER UPDATE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO issues_fts(rowid, text) VALUES (new.rowid, new.text);
END;
