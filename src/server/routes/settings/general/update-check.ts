import { Hono } from "hono";
import { outgoingFetch } from "../../../utils/net/outgoing";
import { getRandomUserAgent } from "../../../utils/net/user-agents";
import { logger } from "../../../utils/logger";
import { settingsAuth } from "../../_guards";
import { useCache } from "../../../utils/cache/cache";

const RELEASE_TAGS_URL = "https://api.github.com/repos/degoog-org/degoog/tags";
const RELEASE_CHECK_TIMEOUT_MS = 8_000;
const UNKNOWN_RELEASE = "Unknown";
const RELEASE_CACHE_TTL_MS = 60 * 60 * 1000;
const RELEASE_CACHE_KEY = "newest";

const router = new Hono();
const _releaseCache = useCache<string>("update-check", RELEASE_CACHE_TTL_MS);

const _newestRelease = async (): Promise<string> => {
  try {
    const res = await outgoingFetch(RELEASE_TAGS_URL, {
      signal: AbortSignal.timeout(RELEASE_CHECK_TIMEOUT_MS),
      headers: {
        "User-Agent": getRandomUserAgent(),
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return UNKNOWN_RELEASE;
    const tags = (await res.json()) as { name?: unknown }[];
    const name = tags?.[0]?.name;
    return typeof name === "string" && name ? name : UNKNOWN_RELEASE;
  } catch (err) {
    logger.debug("settings", "release check failed", err);
    return UNKNOWN_RELEASE;
  }
};

const _cachedRelease = async (fresh: boolean): Promise<string> => {
  if (!fresh) {
    const cached = await _releaseCache.get(RELEASE_CACHE_KEY);
    if (cached) return cached;
  }
  const newest = await _newestRelease();
  if (newest !== UNKNOWN_RELEASE) await _releaseCache.set(RELEASE_CACHE_KEY, newest);
  return newest;
};

router.get(
  "/api/settings/update-check",
  settingsAuth("GET /api/settings/update-check"),
  async (c) => c.json({ newest: await _cachedRelease(c.req.query("fresh") === "1") }),
);

export default router;
