import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import { indexerDir } from "../../../utils/paths";
import { logger } from "../../../utils/logger";
import { pruneCutoff, type FaviconRow, type FaviconStore, type FaviconStoreStats } from "../../types/favicons";

const DB_FILE = "favicon.db";
const SCHEMA_VERSION = 2;
const LOG_TAG = "favicon-store";

const SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS icons (
    key TEXT PRIMARY KEY,
    mime TEXT,
    data BLOB,
    fetched_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS icons_fetched_at ON icons (fetched_at)",
];

const PURGE_MISSES = "DELETE FROM icons WHERE data IS NULL";

interface SqliteRow {
  key: string;
  mime: string | null;
  data: Uint8Array | null;
  fetched_at: number;
}

interface SqliteStats {
  rows: number;
  bytes: number | null;
}

export const faviconDbPath = (): string => join(indexerDir(), DB_FILE);

const _migrate = (db: Database): void => {
  const { user_version: version } = db
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };
  for (const sql of SCHEMA_DDL) db.exec(sql);
  if (version < SCHEMA_VERSION) {
    db.exec(PURGE_MISSES);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
};

export class SqliteFaviconStore implements FaviconStore {
  private _db: Database | null = null;

  async init(): Promise<void> {
    this._open();
  }

  private _open(): Database {
    if (this._db) return this._db;
    mkdirSync(indexerDir(), { recursive: true });
    const db = new Database(faviconDbPath(), { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    try {
      db.transaction(() => _migrate(db))();
    } catch (err) {
      logger.error(LOG_TAG, "sqlite schema init failed", err);
      db.close();
      throw err;
    }
    this._db = db;
    return db;
  }

  async get(key: string): Promise<FaviconRow | null> {
    const row = this._open()
      .query("SELECT key, mime, data, fetched_at FROM icons WHERE key = ?")
      .get(key) as SqliteRow | null;
    if (!row?.data || !row.mime) return null;
    return {
      key: row.key,
      mime: row.mime,
      data: new Uint8Array(row.data),
      fetchedAt: Number(row.fetched_at),
    };
  }

  async put(row: FaviconRow): Promise<void> {
    this._open()
      .query(
        `INSERT INTO icons (key, mime, data, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(row.key, row.mime, row.data, Math.trunc(row.fetchedAt));
  }

  async delete(key: string): Promise<void> {
    this._open().query("DELETE FROM icons WHERE key = ?").run(key);
  }

  async prune(maxAgeDays: number): Promise<number> {
    const result = this._open()
      .query("DELETE FROM icons WHERE fetched_at < ? OR data IS NULL")
      .run(pruneCutoff(maxAgeDays, Date.now()));
    return result.changes;
  }

  async stats(): Promise<FaviconStoreStats> {
    const row = this._open()
      .query(
        "SELECT COUNT(*) AS rows, SUM(LENGTH(data)) AS bytes FROM icons",
      )
      .get() as SqliteStats;
    return { rows: row.rows, bytes: row.bytes ?? 0 };
  }

  async close(): Promise<void> {
    if (!this._db) return;
    try {
      this._db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this._db.close();
    } catch (err) {
      logger.warn(LOG_TAG, "sqlite close failed", err);
    }
    this._db = null;
  }
}
