export interface FaviconRow {
  key: string;
  mime: string;
  data: Uint8Array;
  fetchedAt: number;
}

export interface FaviconStoreStats {
  rows: number;
  bytes: number;
}

export interface FaviconStore {
  init(): Promise<void>;
  get(key: string): Promise<FaviconRow | null>;
  put(row: FaviconRow): Promise<void>;
  delete(key: string): Promise<void>;
  prune(maxAgeDays: number): Promise<number>;
  stats(): Promise<FaviconStoreStats>;
  close(): Promise<void>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export const pruneCutoff = (maxAgeDays: number, now: number): number =>
  now - maxAgeDays * DAY_MS;

export const isRowFresh = (row: FaviconRow, maxAgeDays: number, now: number): boolean =>
  row.fetchedAt >= pruneCutoff(maxAgeDays, now);
