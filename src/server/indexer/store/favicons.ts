import { resolvedPgConnection } from "../db/pg-pool";
import { logger } from "../../utils/logger";
import { getInstanceSettings } from "../../utils/settings/server-settings";
import { faviconStoreConfig, type FaviconStoreConfig } from "../config/favicons";
import { PgFaviconStore } from "../adapters/postgres/favicons";
import { SqliteFaviconStore } from "../adapters/sqlite/favicons";
import type { FaviconStore } from "../types/favicons";

const LOG_TAG = "favicon-store";
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const OPEN_RETRY_MS = 60 * 1000;

let _store: FaviconStore | null = null;
let _opening: Promise<FaviconStore | null> | null = null;
let _pruneTimer: ReturnType<typeof setInterval> | null = null;
let _retryAfter = 0;

const _createStore = (): FaviconStore => {
  const connection = resolvedPgConnection();
  return connection ? new PgFaviconStore(connection) : new SqliteFaviconStore();
};

export const readFaviconStoreConfig = async (): Promise<FaviconStoreConfig> =>
  faviconStoreConfig(await getInstanceSettings());

export const pruneFaviconStore = async (): Promise<number> => {
  const store = _store;
  if (!store) return 0;
  try {
    const { maxAgeDays } = await readFaviconStoreConfig();
    const removed = await store.prune(maxAgeDays);
    if (removed > 0) logger.debug(LOG_TAG, `pruned ${removed} favicon rows`);
    return removed;
  } catch (err) {
    logger.warn(LOG_TAG, "favicon prune failed", err);
    return 0;
  }
};

function _startPruning(): void {
  if (_pruneTimer) return;
  _pruneTimer = setInterval(() => void pruneFaviconStore(), PRUNE_INTERVAL_MS);
  _pruneTimer.unref?.();
  void pruneFaviconStore();
}

const _open = async (): Promise<FaviconStore | null> => {
  const store = _createStore();
  try {
    await store.init();
  } catch (err) {
    logger.warn(LOG_TAG, "favicon store could not open, retrying later", err);
    _retryAfter = Date.now() + OPEN_RETRY_MS;
    await store.close();
    return null;
  }
  _store = store;
  _startPruning();
  return store;
};

export const getFaviconStore = async (): Promise<FaviconStore | null> => {
  const { enabled } = await readFaviconStoreConfig();
  if (!enabled) return null;
  if (_store) return _store;
  if (Date.now() < _retryAfter) return null;
  _opening ??= _open().finally(() => {
    _opening = null;
  });
  return _opening;
};

export const closeFaviconStore = async (): Promise<void> => {
  if (_pruneTimer) {
    clearInterval(_pruneTimer);
    _pruneTimer = null;
  }
  if (_opening) await _opening;
  const store = _store;
  _store = null;
  _retryAfter = 0;
  if (store) await store.close();
};
