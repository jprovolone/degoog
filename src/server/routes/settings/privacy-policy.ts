import { Hono } from "hono";
import { readPrivacyPolicy } from "../../utils/settings/privacy-policy";

const router = new Hono();

router.get("/api/privacy-policy", async (c) =>
  c.json({ markdown: await readPrivacyPolicy() }),
);

export default router;
