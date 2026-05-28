import type { SearchResult } from "../../types";
import { normalizeUrl, urlIsGif } from "../../search/url-normalize";

export interface IndexRow {
  query_norm: string;
  engine_type: string;
  url: string;
  url_norm: string;
  source_engine: string;
  title: string;
  snippet: string;
  thumbnail: string | null;
  image_url: string | null;
  is_gif: number | null;
  duration: string | null;
  extras_json: string | null;
}

export interface Recorder {
  toRows: (queryNorm: string, engineType: string, results: SearchResult[]) => IndexRow[];
}

const KNOWN_FIELDS = new Set([
  "title",
  "url",
  "snippet",
  "source",
  "thumbnail",
  "imageUrl",
  "isGif",
  "duration",
]);

const extractExtras = (r: SearchResult): string | null => {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!KNOWN_FIELDS.has(k) && v !== undefined && v !== null) {
      extras[k] = v;
    }
  }
  return Object.keys(extras).length > 0 ? JSON.stringify(extras) : null;
};

export const DEFAULT_RECORDER: Recorder = {
  toRows: (queryNorm, engineType, results) => {
    const rows: IndexRow[] = [];
    for (const r of results) {
      if (!r.url || !r.title) continue;
      rows.push({
        query_norm: queryNorm,
        engine_type: engineType,
        url: r.url,
        url_norm: normalizeUrl(r.url),
        source_engine: r.source,
        title: r.title,
        snippet: r.snippet ?? "",
        thumbnail: r.thumbnail ?? null,
        image_url: r.imageUrl ?? null,
        is_gif:
          r.isGif === true || urlIsGif(r.imageUrl) ? 1 : r.isGif === false ? 0 : null,
        duration: r.duration ?? null,
        extras_json: extractExtras(r),
      });
    }
    return rows;
  },
};
