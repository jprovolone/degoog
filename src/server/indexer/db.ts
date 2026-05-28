import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { indexerDbFile, indexerDir } from "../utils/paths";
import { logger } from "../utils/logger";

let _db: Database | null = null;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_norm TEXT NOT NULL,
    engine_type TEXT NOT NULL,
    url TEXT NOT NULL,
    url_norm TEXT NOT NULL,
    source_engine TEXT NOT NULL,
    title TEXT NOT NULL,
    snippet TEXT NOT NULL,
    thumbnail TEXT,
    image_url TEXT,
    is_gif INTEGER,
    duration TEXT,
    extras_json TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    source_instance TEXT,
    UNIQUE(query_norm, engine_type, url_norm)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_results_query_type ON results(query_norm, engine_type)`,
  `CREATE INDEX IF NOT EXISTS idx_results_type ON results(engine_type)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS results_fts USING fts5(
    title, snippet, url, query_norm,
    content='results', content_rowid='id'
  )`,
  `CREATE TRIGGER IF NOT EXISTS results_ai AFTER INSERT ON results BEGIN
    INSERT INTO results_fts(rowid, title, snippet, url, query_norm)
    VALUES (new.id, new.title, new.snippet, new.url, new.query_norm);
  END`,
  `CREATE TRIGGER IF NOT EXISTS results_ad AFTER DELETE ON results BEGIN
    INSERT INTO results_fts(results_fts, rowid, title, snippet, url, query_norm)
    VALUES('delete', old.id, old.title, old.snippet, old.url, old.query_norm);
  END`,
  `CREATE TRIGGER IF NOT EXISTS results_au AFTER UPDATE ON results BEGIN
    INSERT INTO results_fts(results_fts, rowid, title, snippet, url, query_norm)
    VALUES('delete', old.id, old.title, old.snippet, old.url, old.query_norm);
    INSERT INTO results_fts(rowid, title, snippet, url, query_norm)
    VALUES (new.id, new.title, new.snippet, new.url, new.query_norm);
  END`,
];

const _migrate = (db: Database): void => {
  for (const sql of MIGRATIONS) db.exec(sql);
};

export const getIndexerDb = (): Database => {
  if (_db) return _db;
  mkdirSync(indexerDir(), { recursive: true });
  const db = new Database(indexerDbFile(), { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  try {
    _migrate(db);
  } catch (err) {
    logger.error("indexer", "migration failed", err);
    throw err;
  }
  _db = db;
  return db;
};

export const closeIndexerDb = (): void => {
  if (!_db) return;
  try {
    _db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    _db.close();
  } catch (err) {
    logger.warn("indexer", "close failed", err);
  }
  _db = null;
};

export const checkpointWal = (): void => {
  if (!_db) return;
  try {
    _db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    logger.warn("indexer", "wal checkpoint failed", err);
  }
};
