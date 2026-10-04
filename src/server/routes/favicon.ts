import { Hono, type MiddlewareHandler } from "hono";
import { normalizeFaviconHost } from "../extensions/favicon/host";
import { resolveFaviconBytes } from "../extensions/favicon/resolve";
import { readObjectBody } from "../utils/hono";
import { buildFaviconUrl } from "../utils/net/proxy-sign";
import { getClientIp } from "../utils/net/request";
import { checkRateLimit } from "../utils/security/rate-limit";
import { settingsAuth } from "./_guards";

const router = new Hono();

const REFRESH_ROUTE = "POST /api/favicon/refresh";
const REFRESH_LIMIT_PREFIX = "favicon-refresh:";
const REFRESH_LIMITS: Record<string, string> = {
  rateLimitEnabled: "true",
  rateLimitBurstWindow: "60",
  rateLimitBurstMax: "10",
  rateLimitLongWindow: "3600",
  rateLimitLongMax: "120",
};

const refreshRateLimit: MiddlewareHandler = async (c, next) => {
  const ip = getClientIp(c) ?? "unknown";
  const result = checkRateLimit(`${REFRESH_LIMIT_PREFIX}${ip}`, REFRESH_LIMITS);
  if (!result.allowed) {
    return c.json({ error: "Too many requests" }, 429, {
      "Retry-After": String(result.retryAfterSec ?? 60),
    });
  }
  return next();
};

router.post("/api/favicon/refresh", settingsAuth(REFRESH_ROUTE), refreshRateLimit, async (c) => {
  const body = await readObjectBody<{ domain?: unknown }>(c);
  if (!body) return c.json({ error: "Invalid JSON" }, 400);
  if (typeof body.domain !== "string") return c.json({ error: "Missing domain" }, 400);
  const host = normalizeFaviconHost(body.domain);
  if (!host) return c.json({ error: "Invalid domain" }, 400);
  const icon = await resolveFaviconBytes(host, { refresh: true });
  const url = icon ? buildFaviconUrl(host, Date.now()) : "";
  return c.json({ url: url || null });
});

export default router;
