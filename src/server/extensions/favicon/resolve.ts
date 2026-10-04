import type { FaviconResult } from "../../types/extension";
import { hasFaviconProviders, runFaviconChain } from "./registry";
import { FAVICON_SIZE } from "./size";
import { useCache } from "../../utils/cache/cache";
import { logger } from "../../utils/logger";
import { outgoingFetch } from "../../utils/net/outgoing";
import { readBodyCapped } from "../../utils/net/read-body";
import { getRandomUserAgent } from "../../utils/net/user-agents";
import { localImageAccess } from "../../utils/security/local-image-access";
import { fetchWithSafeRedirects } from "../../utils/security/safe-redirects";
import { signData } from "../../utils/security/server-key";
import { normalizeFaviconHost } from "./host";
import { forgetFaviconMiss, isFaviconMiss, noteFaviconMiss } from "./misses";
import { getFaviconStore, readFaviconStoreConfig } from "../../indexer/store/favicons";
import { isRowFresh } from "../../indexer/types/favicons";
import { FAVICON_MAX_BYTES, validateFavicon, type FaviconBytes } from "../../utils/security/favicon-bytes";

const LOG_TAG = "favicon";
const CACHE_NAMESPACE = "favicon";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const ROW_KEY_PREFIX = `favicon-row:${FAVICON_SIZE}:`;

type CachedFavicon = { b64: string; contentType: string };

export interface ResolveFaviconOptions {
  refresh?: boolean;
}

const _cache = useCache<CachedFavicon>(CACHE_NAMESPACE, CACHE_TTL_MS);
const _inflight = new Map<string, Promise<FaviconBytes | null>>();

export const faviconRowKey = (host: string): string => signData(`${ROW_KEY_PREFIX}${host}`);

const _encode = (icon: FaviconBytes): CachedFavicon => ({
  b64: Buffer.from(icon.data).toString("base64"),
  contentType: icon.contentType,
});

const _decode = (cached: CachedFavicon): FaviconBytes | null =>
  validateFavicon(new Uint8Array(Buffer.from(cached.b64, "base64")));

const _fetchIcon = async (url: string): Promise<FaviconBytes | null> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    logger.debug(LOG_TAG, "provider returned an unparseable favicon url", err);
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchWithSafeRedirects(
      outgoingFetch,
      parsed.toString(),
      {
        signal: controller.signal,
        headers: {
          "User-Agent": getRandomUserAgent(),
          Accept: "image/webp,image/png,image/x-icon,image/*;q=0.8",
        },
      },
      await localImageAccess(),
    );
    if (!res || !res.ok) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > FAVICON_MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const body = await readBodyCapped(res, FAVICON_MAX_BYTES, FETCH_TIMEOUT_MS);
    if (body === "too-large" || body === "empty") return null;
    return validateFavicon(new Uint8Array(body));
  } catch (err) {
    logger.debug(LOG_TAG, "favicon fetch failed", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const _materialize = async (result: NonNullable<FaviconResult>): Promise<FaviconBytes | null> => {
  if ("url" in result) return _fetchIcon(result.url);
  return validateFavicon(result.data);
};

async function _writeBack(key: string, icon: FaviconBytes | null): Promise<void> {
  if (!icon) {
    await noteFaviconMiss(key);
    return;
  }
  await _cache.set(key, _encode(icon));
  const store = await getFaviconStore();
  if (!store) return;
  try {
    await store.put({
      key,
      mime: icon.contentType,
      data: icon.data,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    logger.warn(LOG_TAG, "favicon store write failed", err);
  }
}

async function _forget(key: string): Promise<void> {
  await _cache.delete(key);
  await forgetFaviconMiss(key);
  const store = await getFaviconStore();
  if (!store) return;
  try {
    await store.delete(key);
  } catch (err) {
    logger.warn(LOG_TAG, "favicon store delete failed", err);
  }
}

const _fromStore = async (key: string): Promise<FaviconBytes | null> => {
  const store = await getFaviconStore();
  if (!store) return null;
  try {
    const row = await store.get(key);
    if (!row) return null;
    const { maxAgeDays } = await readFaviconStoreConfig();
    if (!isRowFresh(row, maxAgeDays, Date.now())) return null;
    return validateFavicon(row.data);
  } catch (err) {
    logger.warn(LOG_TAG, "favicon store read failed", err);
    return null;
  }
};

const _lookup = async (host: string, refresh: boolean): Promise<FaviconBytes | null> => {
  const key = faviconRowKey(host);
  if (refresh && hasFaviconProviders()) {
    await _forget(key);
  } else {
    const cached = await _cache.get(key);
    const decoded = cached ? _decode(cached) : null;
    if (decoded) return decoded;
    const stored = await _fromStore(key);
    if (stored) {
      await _cache.set(key, _encode(stored));
      return stored;
    }
    if (await isFaviconMiss(key)) return null;
  }
  if (!hasFaviconProviders()) return null;
  const icon = await runFaviconChain(host, _materialize);
  await _writeBack(key, icon);
  return icon;
};

export const resolveFaviconBytes = async (
  host: string,
  opts: ResolveFaviconOptions = {},
): Promise<FaviconBytes | null> => {
  const normalized = normalizeFaviconHost(host);
  if (!normalized) return null;
  const refresh = opts.refresh === true;
  const flightKey = `${refresh ? "refresh" : "lookup"}:${normalized}`;
  const pending = _inflight.get(flightKey);
  if (pending) return pending;
  const flight = _lookup(normalized, refresh)
    .catch((err: unknown) => {
      logger.warn(LOG_TAG, "favicon resolve failed", err);
      return null;
    })
    .finally(() => {
      _inflight.delete(flightKey);
    });
  _inflight.set(flightKey, flight);
  return flight;
};
