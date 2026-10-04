import { leasePgPool, type PgConnectionInput, type PgPoolLease } from "../../db/pg-pool";
import { logger } from "../../../utils/logger";
import { pruneCutoff, type FaviconRow, type FaviconStore, type FaviconStoreStats } from "../../types/favicons";

export const FAVICON_PG_SCHEMA = "degoog_favicon";
export const FAVICON_PG_TABLE = "icons";
const LOG_TAG = "favicon-store";

interface PgRow {
  key: string;
  mime: string | null;
  data: Uint8Array | null;
  fetched_at: number | string;
}

interface PgStats {
  rows: number | string;
  bytes: number | string | null;
}

export class PgFaviconStore implements FaviconStore {
  private readonly _connection: PgConnectionInput;
  private _lease: PgPoolLease | null = null;

  constructor(connection: PgConnectionInput) {
    this._connection = connection;
  }

  private _sql(): PgPoolLease["sql"] {
    if (!this._lease) this._lease = leasePgPool(this._connection);
    return this._lease.sql;
  }

  async init(): Promise<void> {
    const sql = this._sql();
    await sql.begin(async (tx) => {
      await tx`CREATE SCHEMA IF NOT EXISTS ${tx(FAVICON_PG_SCHEMA)}`;
      await tx`
        CREATE TABLE IF NOT EXISTS ${tx(FAVICON_PG_SCHEMA)}.${tx(FAVICON_PG_TABLE)} (
          key TEXT PRIMARY KEY,
          mime TEXT,
          data BYTEA,
          fetched_at BIGINT NOT NULL
        )
      `;
      await tx`
        CREATE INDEX IF NOT EXISTS icons_fetched_at
        ON ${tx(FAVICON_PG_SCHEMA)}.${tx(FAVICON_PG_TABLE)} (fetched_at)
      `;
      await tx`DELETE FROM ${tx(FAVICON_PG_SCHEMA)}.${tx(FAVICON_PG_TABLE)} WHERE data IS NULL`;
    });
  }

  async get(key: string): Promise<FaviconRow | null> {
    const sql = this._sql();
    const rows = await sql<PgRow[]>`
      SELECT key, mime, data, fetched_at
      FROM ${sql(FAVICON_PG_SCHEMA)}.${sql(FAVICON_PG_TABLE)}
      WHERE key = ${key}
    `;
    const row = rows[0];
    if (!row?.data || !row.mime) return null;
    return {
      key: row.key,
      mime: row.mime,
      data: new Uint8Array(row.data),
      fetchedAt: Number(row.fetched_at),
    };
  }

  async put(row: FaviconRow): Promise<void> {
    const sql = this._sql();
    const data = Buffer.from(row.data);
    await sql`
      INSERT INTO ${sql(FAVICON_PG_SCHEMA)}.${sql(FAVICON_PG_TABLE)} (key, mime, data, fetched_at)
      VALUES (${row.key}, ${row.mime}, ${data}, ${Math.trunc(row.fetchedAt)})
      ON CONFLICT (key) DO UPDATE
      SET mime = EXCLUDED.mime, data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
    `;
  }

  async delete(key: string): Promise<void> {
    const sql = this._sql();
    await sql`DELETE FROM ${sql(FAVICON_PG_SCHEMA)}.${sql(FAVICON_PG_TABLE)} WHERE key = ${key}`;
  }

  async prune(maxAgeDays: number): Promise<number> {
    const sql = this._sql();
    const result = await sql`
      DELETE FROM ${sql(FAVICON_PG_SCHEMA)}.${sql(FAVICON_PG_TABLE)}
      WHERE fetched_at < ${Math.trunc(pruneCutoff(maxAgeDays, Date.now()))}
        OR data IS NULL
    `;
    return result.count;
  }

  async stats(): Promise<FaviconStoreStats> {
    const sql = this._sql();
    const rows = await sql<PgStats[]>`
      SELECT
        COUNT(*) AS rows,
        SUM(OCTET_LENGTH(data)) AS bytes
      FROM ${sql(FAVICON_PG_SCHEMA)}.${sql(FAVICON_PG_TABLE)}
    `;
    const row = rows[0];
    return {
      rows: Number(row?.rows ?? 0),
      bytes: Number(row?.bytes ?? 0),
    };
  }

  async close(): Promise<void> {
    const lease = this._lease;
    this._lease = null;
    if (!lease) return;
    try {
      await lease.release();
    } catch (err) {
      logger.warn(LOG_TAG, "postgres close failed", err);
    }
  }
}
