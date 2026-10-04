import { Hono } from "hono";
import { getClientIp } from "../../utils/net/request";
import { checkRateLimit, rateLimitOptionsFrom } from "../../utils/security/rate-limit";
import { getInstanceSettings } from "../../utils/settings/server-settings";

const router = new Hono();

router.get("/api/rate-limit/test", async (c) => {
  if (process.env.LOG_LEVEL !== "debug") return;

  const settings = await getInstanceSettings();
  const opts = rateLimitOptionsFrom(settings);
  if (opts.rateLimitEnabled !== "true") {
    return c.json({ rateLimitEnabled: false });
  }
  const ip = getClientIp(c) ?? "unknown";
  const result = checkRateLimit(ip, opts);
  if (!result.allowed && result.retryAfterSec !== undefined) {
    return c.json(
      { allowed: false, retryAfterSec: result.retryAfterSec },
      429,
      { "Retry-After": String(result.retryAfterSec) },
    );
  }
  return c.json({ allowed: true });
});

export default router;
