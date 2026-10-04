import { createHash } from "crypto";
import type { PgSql } from "./statements";

const indexNameFor = (schema: string, suffix: string): string => {
  // PostgreSQL identifiers are limited to 63 bytes.
  const hash = createHash("sha1").update(schema).digest("hex").slice(0, 8);
  const prefix = "idx_";
  const maxSchemaLen = 63 - prefix.length - suffix.length - hash.length - 1;
  return `${prefix}${schema.slice(0, maxSchemaLen)}_${hash}${suffix}`;
};

const ensureConcurrentIndex = async (
  sql: PgSql,
  schema: string,
  indexName: string,
  create: () => Promise<unknown>,
): Promise<boolean> => {
  const readValid = async (): Promise<boolean | null> => {
    const [index] = await sql<{ indisvalid: boolean }[]>`
      SELECT i.indisvalid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relkind = 'i'
        AND c.relname = ${indexName}
        AND n.nspname = ${schema}
    `;
    return index ? index.indisvalid : null;
  };

  const buildInProgress = async (): Promise<boolean> => {
    const rows = await sql<{ one: number }[]>`
      SELECT 1 AS one
      FROM pg_stat_progress_create_index p
      JOIN pg_class c ON c.oid = p.index_relid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = ${indexName}
        AND n.nspname = ${schema}
    `;
    return rows.length > 0;
  };

  const valid = await readValid();
  if (valid) return true;
  if (valid === false && (await buildInProgress())) return false;

  if (valid === false) {
    await sql`
      DROP INDEX CONCURRENTLY IF EXISTS
      ${sql(schema)}.${sql(indexName)}
    `;
  }

  await create();
  return (await readValid()) === true;
};

export const ensureHitsIndex = async (sql: PgSql, schema: string): Promise<void> => {
  const indexName = indexNameFor(schema, "_hits_url_id");
  await ensureConcurrentIndex(sql, schema, indexName, () => sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS
    ${sql(indexName)}
    ON ${sql(schema)}.query_hits (url_id)
  `);
};

const FOLD_COLUMN_LOCK_TIMEOUT = "5s";

export const ensureFoldColumn = async (sql: PgSql, schema: string): Promise<boolean> => {
  const hasColumn = async (): Promise<boolean> => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name = 'urls'
        AND column_name = 'search_fold'
    `;
    return rows.length > 0;
  };

  if (await hasColumn()) return true;

  await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL lock_timeout = '${FOLD_COLUMN_LOCK_TIMEOUT}'`);
    await tx`ALTER TABLE ${tx(schema)}.urls ADD COLUMN IF NOT EXISTS search_fold tsvector`;
  });
  return hasColumn();
};

export const ensureFoldIndex = async (sql: PgSql, schema: string): Promise<boolean> => {
  const indexName = indexNameFor(schema, "_urls_fold");
  return ensureConcurrentIndex(sql, schema, indexName, () => sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS
    ${sql(indexName)}
    ON ${sql(schema)}.urls USING GIN (search_fold)
  `);
};

export const ensureHitsColumns = async (sql: PgSql, schema: string): Promise<void> => {
  const existing = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema}
      AND table_name = 'query_hits'
      AND column_name IN ('pos_sum', 'sources_json', 'filters_json', 'meta_json')
  `;
  const present = new Set(existing.map((c) => c.column_name));
  const hadPosSum = present.has("pos_sum");

  if (!hadPosSum)
    await sql`ALTER TABLE ${sql(schema)}.query_hits ADD COLUMN IF NOT EXISTS pos_sum BIGINT NOT NULL DEFAULT 9999`;
  if (!present.has("sources_json"))
    await sql`ALTER TABLE ${sql(schema)}.query_hits ADD COLUMN IF NOT EXISTS sources_json TEXT`;
  if (!present.has("filters_json"))
    await sql`ALTER TABLE ${sql(schema)}.query_hits ADD COLUMN IF NOT EXISTS filters_json TEXT`;
  if (!present.has("meta_json"))
    await sql`ALTER TABLE ${sql(schema)}.query_hits ADD COLUMN IF NOT EXISTS meta_json TEXT`;

  if (!hadPosSum)
    await sql`UPDATE ${sql(schema)}.query_hits SET pos_sum = best_position * hit_count`;
};
