import { Hono } from "hono";
import { asString, getSettings } from "../utils/plugin-settings";
import { DEFAULT_LANGUAGES, DEGOOG_SETTINGS_ID } from "../utils/search";

const router = new Hono();

router.get("/api/settings/streaming", async (c) => {
  const settings = await getSettings(DEGOOG_SETTINGS_ID);
  return c.json({
    enabled: asString(settings.streamingEnabled) === "true",
    autoRetry: asString(settings.streamingAutoRetry) === "true",
    maxRetries: parseInt(asString(settings.streamingMaxRetries) || "2", 10),
  });
});

router.get("/api/settings/languages", async (c) => {
  const settings = await getSettings(DEGOOG_SETTINGS_ID);
  if (asString(settings["languagesEnabled"] ?? "") !== "true") {
    return c.json({ languages: DEFAULT_LANGUAGES });
  }
  const raw = asString(settings["languages"] ?? "");
  const codes = raw
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,3}$/.test(s));
  return c.json({ languages: codes.length > 0 ? codes : DEFAULT_LANGUAGES });
});

export default router;
