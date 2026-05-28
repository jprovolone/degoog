import type { SearchResult } from "../types";
import { statSync } from "fs";
import { getIndexerDb } from "./db";
import { indexerDbFile } from "../utils/paths";
import { normalizeQuery } from "./normalize";
import { recorderFor, type IndexRow } from "./recorders";
import { logger } from "../utils/logger";

export const DEGOOG_ENGINE_NAME = "Degoog";

export interface IndexerStats {
  totalResults: number;
  totalQueries: number;
  byType: Record<string, number>;
  dbSizeBytes: number;
}

export interface MergeReport {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface ExportRow extends IndexRow {
  first_seen: number;
  last_seen: number;
  source_instance: string | null;
}

const FTS_ESCAPE = /["()]/g;

const escapeFtsTerm = (s: string): string =>
  `"${s.replace(FTS_ESCAPE, " ").trim()}"`;

const buildFtsQuery = (queryNorm: string): string => {
  const terms = queryNorm
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map(escapeFtsTerm);
  return terms.length > 0 ? terms.join(" OR ") : "";
};

const INSERT_SQL = `
  INSERT INTO results (
    query_norm, engine_type, url, url_norm, source_engine,
    title, snippet, thumbnail, image_url, is_gif, duration, extras_json,
    first_seen, last_seen, source_instance
  ) VALUES (
    $query_norm, $engine_type, $url, $url_norm, $source_engine,
    $title, $snippet, $thumbnail, $image_url, $is_gif, $duration, $extras_json,
    $first_seen, $last_seen, $source_instance
  )
  ON CONFLICT(query_norm, engine_type, url_norm) DO UPDATE SET
    last_seen = excluded.last_seen,
    title = CASE WHEN length(results.title) >= length(excluded.title) THEN results.title ELSE excluded.title END,
    snippet = CASE WHEN length(results.snippet) >= length(excluded.snippet) THEN results.snippet ELSE excluded.snippet END,
    thumbnail = COALESCE(results.thumbnail, excluded.thumbnail),
    image_url = COALESCE(results.image_url, excluded.image_url),
    is_gif = COALESCE(results.is_gif, excluded.is_gif),
    duration = COALESCE(results.duration, excluded.duration),
    extras_json = COALESCE(results.extras_json, excluded.extras_json)
`;

export const recordResults = (
  query: string,
  engineType: string,
  results: SearchResult[],
): void => {
  if (!query || results.length === 0) return;
  const queryNorm = normalizeQuery(query);
  if (!queryNorm) return;
  const recorder = recorderFor(engineType);
  const rows = recorder.toRows(queryNorm, engineType, results);
  if (rows.length === 0) return;
  const now = Date.now();
  try {
    const db = getIndexerDb();
    const insert = db.prepare(INSERT_SQL);
    const tx = db.transaction((batch: IndexRow[]) => {
      for (const row of batch) {
        insert.run({
          $query_norm: row.query_norm,
          $engine_type: row.engine_type,
          $url: row.url,
          $url_norm: row.url_norm,
          $source_engine: row.source_engine,
          $title: row.title,
          $snippet: row.snippet,
          $thumbnail: row.thumbnail,
          $image_url: row.image_url,
          $is_gif: row.is_gif,
          $duration: row.duration,
          $extras_json: row.extras_json,
          $first_seen: now,
          $last_seen: now,
          $source_instance: null,
        });
      }
    });
    tx(rows);
  } catch (err) {
    logger.warn("indexer", `recordResults failed for "${queryNorm}"`, err);
  }
};

interface ResultsRow {
  url: string;
  source_engine: string;
  title: string;
  snippet: string;
  thumbnail: string | null;
  image_url: string | null;
  is_gif: number | null;
  duration: string | null;
  extras_json: string | null;
}

const rowToResult = (row: ResultsRow): SearchResult => {
  const base: SearchResult = {
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    source: DEGOOG_ENGINE_NAME,
  };
  if (row.thumbnail) base.thumbnail = row.thumbnail;
  if (row.image_url) base.imageUrl = row.image_url;
  if (row.is_gif !== null) base.isGif = row.is_gif === 1;
  if (row.duration) base.duration = row.duration;
  if (row.extras_json) {
    try {
      const extras = JSON.parse(row.extras_json) as Record<string, unknown>;
      Object.assign(base, extras);
    } catch (err) {
      logger.debug("indexer", "extras_json parse failed", err);
    }
  }
  return base;
};

export const queryIndex = (
  query: string,
  engineType: string,
  limit = 30,
): SearchResult[] => {
  const queryNorm = normalizeQuery(query);
  if (!queryNorm) return [];
  try {
    const db = getIndexerDb();
    const exactStmt = db.prepare(`
      SELECT url, source_engine, title, snippet, thumbnail, image_url,
             is_gif, duration, extras_json, last_seen
      FROM results
      WHERE engine_type = ? AND query_norm = ?
      ORDER BY last_seen DESC
      LIMIT ?
    `);
    const exact = exactStmt.all(engineType, queryNorm, limit) as Array<
      ResultsRow & { last_seen: number }
    >;

    const seen = new Set(exact.map((r) => r.url));
    const remaining = limit - exact.length;
    let fuzzy: Array<ResultsRow & { last_seen: number }> = [];
    if (remaining > 0) {
      const ftsQuery = buildFtsQuery(queryNorm);
      if (ftsQuery) {
        const fuzzyStmt = db.prepare(`
          SELECT r.url, r.source_engine, r.title, r.snippet, r.thumbnail,
                 r.image_url, r.is_gif, r.duration, r.extras_json, r.last_seen
          FROM results_fts f
          JOIN results r ON r.id = f.rowid
          WHERE results_fts MATCH ?
            AND r.engine_type = ?
            AND r.query_norm != ?
          ORDER BY rank, r.last_seen DESC
          LIMIT ?
        `);
        fuzzy = fuzzyStmt.all(ftsQuery, engineType, queryNorm, remaining) as Array<
          ResultsRow & { last_seen: number }
        >;
      }
    }

    const combined = [...exact, ...fuzzy.filter((r) => !seen.has(r.url))];
    return combined.map(rowToResult);
  } catch (err) {
    logger.warn("indexer", "queryIndex failed", err);
    return [];
  }
};

export const getKnownTypes = (): string[] => {
  try {
    const db = getIndexerDb();
    const rows = db
      .prepare("SELECT DISTINCT engine_type FROM results")
      .all() as Array<{ engine_type: string }>;
    return rows.map((r) => r.engine_type);
  } catch (err) {
    logger.warn("indexer", "getKnownTypes failed", err);
    return [];
  }
};

export const getStats = (): IndexerStats => {
  try {
    const db = getIndexerDb();
    const total = (
      db.prepare("SELECT COUNT(*) AS c FROM results").get() as { c: number }
    ).c;
    const queries = (
      db.prepare("SELECT COUNT(DISTINCT query_norm) AS c FROM results").get() as {
        c: number;
      }
    ).c;
    const byTypeRows = db
      .prepare("SELECT engine_type, COUNT(*) AS c FROM results GROUP BY engine_type")
      .all() as Array<{ engine_type: string; c: number }>;
    const byType: Record<string, number> = {};
    for (const r of byTypeRows) byType[r.engine_type] = r.c;
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(indexerDbFile()).size;
    } catch {
      dbSizeBytes = 0;
    }
    return {
      totalResults: total,
      totalQueries: queries,
      byType,
      dbSizeBytes,
    };
  } catch (err) {
    logger.warn("indexer", "getStats failed", err);
    return { totalResults: 0, totalQueries: 0, byType: {}, dbSizeBytes: 0 };
  }
};

export const clearAll = (): void => {
  try {
    const db = getIndexerDb();
    db.exec("DELETE FROM results");
    db.exec("INSERT INTO results_fts(results_fts) VALUES('rebuild')");
    db.exec("VACUUM");
  } catch (err) {
    logger.error("indexer", "clearAll failed", err);
    throw err;
  }
};

const MERGE_SQL = `
  INSERT INTO results (
    query_norm, engine_type, url, url_norm, source_engine,
    title, snippet, thumbnail, image_url, is_gif, duration, extras_json,
    first_seen, last_seen, source_instance
  ) VALUES (
    $query_norm, $engine_type, $url, $url_norm, $source_engine,
    $title, $snippet, $thumbnail, $image_url, $is_gif, $duration, $extras_json,
    $first_seen, $last_seen, $source_instance
  )
  ON CONFLICT(query_norm, engine_type, url_norm) DO UPDATE SET
    last_seen = MAX(results.last_seen, excluded.last_seen),
    thumbnail = COALESCE(results.thumbnail, excluded.thumbnail),
    image_url = COALESCE(results.image_url, excluded.image_url),
    is_gif = COALESCE(results.is_gif, excluded.is_gif),
    duration = COALESCE(results.duration, excluded.duration),
    extras_json = COALESCE(results.extras_json, excluded.extras_json)
`;

export const mergeImport = (
  rows: ExportRow[],
  sourceInstance: string,
): MergeReport => {
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  const report: MergeReport = { inserted: 0, updated: 0, skipped: 0 };
  try {
    const db = getIndexerDb();
    const existsStmt = db.prepare(
      "SELECT 1 FROM results WHERE query_norm = ? AND engine_type = ? AND url_norm = ?",
    );
    const merge = db.prepare(MERGE_SQL);
    const tx = db.transaction((batch: ExportRow[]) => {
      for (const row of batch) {
        if (!row.url_norm || !row.query_norm || !row.engine_type) {
          report.skipped++;
          continue;
        }
        const existed =
          existsStmt.get(row.query_norm, row.engine_type, row.url_norm) !== null;
        merge.run({
          $query_norm: row.query_norm,
          $engine_type: row.engine_type,
          $url: row.url,
          $url_norm: row.url_norm,
          $source_engine: row.source_engine,
          $title: row.title,
          $snippet: row.snippet,
          $thumbnail: row.thumbnail,
          $image_url: row.image_url,
          $is_gif: row.is_gif,
          $duration: row.duration,
          $extras_json: row.extras_json,
          $first_seen: row.first_seen,
          $last_seen: row.last_seen,
          $source_instance: sourceInstance,
        });
        if (existed) report.updated++;
        else report.inserted++;
      }
    });
    tx(rows);
    return report;
  } catch (err) {
    logger.error("indexer", "mergeImport failed", err);
    throw err;
  }
};

export const exportRows = (): ExportRow[] => {
  try {
    const db = getIndexerDb();
    return db
      .prepare(
        `SELECT query_norm, engine_type, url, url_norm, source_engine,
                title, snippet, thumbnail, image_url, is_gif, duration,
                extras_json, first_seen, last_seen, source_instance
         FROM results`,
      )
      .all() as ExportRow[];
  } catch (err) {
    logger.warn("indexer", "exportRows failed", err);
    return [];
  }
};

export const sampleRows = (limit = 5): ExportRow[] => {
  try {
    const db = getIndexerDb();
    return db
      .prepare(
        `SELECT query_norm, engine_type, url, url_norm, source_engine,
                title, snippet, thumbnail, image_url, is_gif, duration,
                extras_json, first_seen, last_seen, source_instance
         FROM results
         ORDER BY last_seen DESC
         LIMIT ?`,
      )
      .all(limit) as ExportRow[];
  } catch (err) {
    logger.warn("indexer", "sampleRows failed", err);
    return [];
  }
};
