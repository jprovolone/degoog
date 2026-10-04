import postgres from "postgres";
import { resolvePgConfig, type PgConnectionConfig } from "./pg-config";

export type PgSql = ReturnType<typeof postgres>;
export type PgConnectionInput = string | PgConnectionConfig;

export interface PgPoolLease {
  sql: PgSql;
  release: () => Promise<void>;
}

interface PoolEntry {
  sql: PgSql;
  leases: number;
}

const POOL_OPTIONS = { max: 10, idle_timeout: 30, connect_timeout: 10, prepare: false };

const _pools = new Map<string, PoolEntry>();

const _poolKey = (connection: PgConnectionInput): string =>
  typeof connection === "string" ? connection : JSON.stringify(connection);

const _createPool = (connection: PgConnectionInput): PgSql =>
  typeof connection === "string"
    ? postgres(connection, POOL_OPTIONS)
    : postgres({ ...connection, ...POOL_OPTIONS });

export const leasePgPool = (connection: PgConnectionInput): PgPoolLease => {
  const key = _poolKey(connection);
  let entry = _pools.get(key);
  if (!entry) {
    entry = { sql: _createPool(connection), leases: 0 };
    _pools.set(key, entry);
  }
  entry.leases++;
  const held = entry;
  let released = false;
  return {
    sql: held.sql,
    release: async () => {
      if (released) return;
      released = true;
      held.leases--;
      if (held.leases > 0) return;
      if (_pools.get(key) === held) _pools.delete(key);
      await held.sql.end();
    },
  };
};

export const resolvedPgConnection = (): PgConnectionInput | null => {
  const resolved = resolvePgConfig();
  if (resolved.mode === "url") return resolved.url;
  if (resolved.mode === "config") return resolved.config;
  return null;
};
