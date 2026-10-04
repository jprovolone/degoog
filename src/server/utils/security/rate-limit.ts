export const BURST_WINDOW_SEC = 20;
export const BURST_MAX = 15;
export const LONG_WINDOW_SEC = 600;
export const LONG_MAX = 150;

const WINDOW_MIN_SEC = 1;
const WINDOW_MAX_SEC = 3600;
const MAX_REQUESTS_MIN = 1;
const MAX_REQUESTS_MAX = 1000;

type RateLimitOptions = Record<string, string | undefined>;

export const rateLimitOptionsFrom = (
  settings: Record<string, string | string[] | boolean | undefined>,
): RateLimitOptions => {
  const opts: RateLimitOptions = {};
  for (const [k, v] of Object.entries(settings)) {
    if (typeof v === "boolean") opts[k] = v ? "true" : "false";
    else if (Array.isArray(v)) opts[k] = v[0] ?? "";
    else opts[k] = v ?? "";
  }
  return opts;
};

const _parseNum = (
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number => {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.floor(n);
};

export const parseRateLimitOptions = (
  options: RateLimitOptions,
): {
  burstWindowSec: number;
  burstMax: number;
  longWindowSec: number;
  longMax: number;
} => ({
  burstWindowSec: _parseNum(
    options.rateLimitBurstWindow,
    WINDOW_MIN_SEC,
    WINDOW_MAX_SEC,
    BURST_WINDOW_SEC,
  ),
  burstMax: _parseNum(
    options.rateLimitBurstMax,
    MAX_REQUESTS_MIN,
    MAX_REQUESTS_MAX,
    BURST_MAX,
  ),
  longWindowSec: _parseNum(
    options.rateLimitLongWindow,
    WINDOW_MIN_SEC,
    WINDOW_MAX_SEC,
    LONG_WINDOW_SEC,
  ),
  longMax: _parseNum(
    options.rateLimitLongMax,
    MAX_REQUESTS_MIN,
    MAX_REQUESTS_MAX,
    LONG_MAX,
  ),
});

const store = new Map<string, number[]>();
const MAX_IPS = 100_000;

const _burstStart = (timestamps: number[], burstCutoff: number): number => {
  let i = timestamps.length;
  while (i > 0 && timestamps[i - 1] >= burstCutoff) i--;
  return i;
};

const _evictOldest = (): void => {
  let oldestKey: string | null = null;
  let oldestFirst = Infinity;
  for (const [k, ts] of store) {
    if (ts.length > 0 && ts[0] < oldestFirst) {
      oldestFirst = ts[0];
      oldestKey = k;
    }
  }
  if (oldestKey !== null) store.delete(oldestKey);
};

export const checkRateLimit = (
  ip: string,
  options: RateLimitOptions,
): { allowed: boolean; retryAfterSec?: number } => {
  if (options.rateLimitEnabled !== "true") {
    return { allowed: true };
  }

  const { burstWindowSec, burstMax, longWindowSec, longMax } =
    parseRateLimitOptions(options);
  const now = Date.now();
  const key = ip || "unknown";

  let timestamps = store.get(key);
  if (!timestamps) {
    timestamps = [];
    if (store.size >= MAX_IPS) _evictOldest();
    store.set(key, timestamps);
  }

  timestamps.push(now);
  const longCutoff = now - longWindowSec * 1000;
  let expired = 0;
  while (expired < timestamps.length && timestamps[expired] < longCutoff) {
    expired++;
  }
  const keep = Math.max(burstMax, longMax) + 1;
  const drop = Math.max(expired, timestamps.length - keep);
  if (drop > 0) timestamps.splice(0, drop);

  if (timestamps.length > longMax) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((timestamps[0] + longWindowSec * 1000 - now) / 1000),
    );
    return { allowed: false, retryAfterSec };
  }

  const burstStart = _burstStart(timestamps, now - burstWindowSec * 1000);
  if (timestamps.length - burstStart > burstMax) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((timestamps[burstStart] + burstWindowSec * 1000 - now) / 1000),
    );
    return { allowed: false, retryAfterSec };
  }

  return { allowed: true };
};

export function clearRateLimitState(): void {
  store.clear();
}
