import { Hono } from "hono";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import {
  clearAll,
  getStats,
  mergeImport,
  sampleRows,
  type ExportRow,
  type MergeReport,
} from "../indexer/store";
import { checkpointWal } from "../indexer/db";
import { indexerDbFile } from "../utils/paths";
import { getInstanceSettings } from "../utils/server-settings";
import { asBoolean } from "../utils/plugin-settings";
import { guardSettingsRoute } from "./settings-auth";
import { _applyRateLimit } from "../utils/search";
import { isSafeHost } from "../utils/ssrf";
import { logger } from "../utils/logger";

const router = new Hono();

const MAX_RECEIVE_BYTES = 200 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 60_000;
const PUSH_COOLDOWN_MS = 60_000;

const _pushCooldown = new Map<string, number>();

const gateMaster = async (): Promise<boolean> => {
  const settings = await getInstanceSettings();
  return asBoolean(settings.degoogIndexerEnabled);
};

const gatePublic = async (): Promise<boolean> => {
  const settings = await getInstanceSettings();
  return (
    asBoolean(settings.degoogIndexerEnabled) &&
    asBoolean(settings.degoogIndexerPublicExport)
  );
};

const gateIncoming = async (): Promise<boolean> => {
  const settings = await getInstanceSettings();
  return (
    asBoolean(settings.degoogIndexerEnabled) &&
    asBoolean(settings.degoogIndexerAcceptIncoming)
  );
};

const ensureValidUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
};

const baseUrlOf = (url: URL): string =>
  `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

router.get("/api/indexer/stats", async (c) => {
  const limitRes = await _applyRateLimit(c);
  if (limitRes) return limitRes;

  if (!(await gateMaster())) {
    return c.json({ error: "Indexer is disabled" }, 404);
  }

  if (!(await gatePublic())) {
    const denied = await guardSettingsRoute(c, "GET /api/indexer/stats");
    if (denied) return denied;
  }

  return c.json(getStats());
});

router.get("/api/indexer/sample", async (c) => {
  const limitRes = await _applyRateLimit(c);
  if (limitRes) return limitRes;

  if (!(await gateMaster())) {
    return c.json({ error: "Indexer is disabled" }, 404);
  }

  if (!(await gatePublic())) {
    const denied = await guardSettingsRoute(c, "GET /api/indexer/sample");
    if (denied) return denied;
  }

  const limit = Math.max(
    1,
    Math.min(20, parseInt(c.req.query("limit") ?? "5", 10) || 5),
  );
  return c.json({ rows: sampleRows(limit) });
});

router.get("/api/indexer/export", async (c) => {
  const limitRes = await _applyRateLimit(c);
  if (limitRes) return limitRes;

  if (!(await gateMaster())) {
    return c.json({ error: "Indexer is disabled" }, 404);
  }

  if (!(await gatePublic())) {
    const denied = await guardSettingsRoute(c, "GET /api/indexer/export");
    if (denied) return denied;
  }

  try {
    checkpointWal();
    const buf = await readFile(indexerDbFile());
    return new Response(buf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="degoog-index.db"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("indexer", "export read failed", err);
    return c.json({ error: "Export failed" }, 500);
  }
});

router.post("/api/indexer/push", async (c) => {
  const limitRes = await _applyRateLimit(c);
  if (limitRes) return limitRes;

  if (!(await gateMaster())) {
    return c.json({ error: "Indexer is disabled" }, 404);
  }

  if (!(await gatePublic())) {
    const denied = await guardSettingsRoute(c, "POST /api/indexer/push");
    if (denied) return denied;
  }

  let body: { targetUrl?: string };
  try {
    body = await c.req.json<{ targetUrl?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const url = ensureValidUrl((body.targetUrl ?? "").trim());
  if (!url) return c.json({ error: "Invalid target url" }, 400);

  if (!(await isSafeHost(url.hostname))) {
    return c.json({ error: "Target host is not allowed" }, 400);
  }

  const key = baseUrlOf(url);
  const now = Date.now();
  const last = _pushCooldown.get(key) ?? 0;
  if (now - last < PUSH_COOLDOWN_MS) {
    const retryIn = Math.ceil((PUSH_COOLDOWN_MS - (now - last)) / 1000);
    return c.json(
      { error: `Cooldown active. Retry in ${retryIn}s` },
      429,
    );
  }
  _pushCooldown.set(key, now);

  try {
    checkpointWal();
    const buf = await readFile(indexerDbFile());
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const res = await fetch(`${key}/api/indexer/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `Target returned ${res.status}`, detail: text.slice(0, 500) },
        502,
      );
    }
    const report = (await res.json()) as MergeReport & { total?: number };
    return c.json({ ok: true, target: key, ...report });
  } catch (err) {
    logger.warn("indexer", `push failed to ${key}`, err);
    return c.json({ error: "Failed to push to target" }, 502);
  }
});

router.post("/api/indexer/receive", async (c) => {
  const limitRes = await _applyRateLimit(c);
  if (limitRes) return limitRes;

  if (!(await gateIncoming())) {
    return c.json({ error: "Incoming uploads disabled" }, 403);
  }

  const contentLengthRaw = c.req.header("content-length");
  const contentLength = contentLengthRaw ? parseInt(contentLengthRaw, 10) : 0;
  if (contentLength > MAX_RECEIVE_BYTES) {
    return c.json({ error: "Upload exceeds size limit" }, 413);
  }

  let tempDir: string | null = null;
  let attachedDb: Database | null = null;
  try {
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) {
      return c.json({ error: "Empty upload" }, 400);
    }
    if (buf.byteLength > MAX_RECEIVE_BYTES) {
      return c.json({ error: "Upload exceeds size limit" }, 413);
    }
    const header = new TextDecoder().decode(buf.slice(0, 16));
    if (!header.startsWith("SQLite format 3")) {
      return c.json({ error: "Not a SQLite database" }, 400);
    }

    tempDir = await mkdtemp(join(tmpdir(), "degoog-receive-"));
    const tempPath = join(tempDir, "incoming.db");
    await writeFile(tempPath, buf);

    attachedDb = new Database(tempPath, { readonly: true });
    const rows = attachedDb
      .prepare(
        `SELECT query_norm, engine_type, url, url_norm, source_engine,
                title, snippet, thumbnail, image_url, is_gif, duration,
                extras_json, first_seen, last_seen, source_instance
         FROM results`,
      )
      .all() as ExportRow[];

    const sourceLabel =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "incoming";
    const report: MergeReport = mergeImport(rows, sourceLabel);
    return c.json({ ...report, total: rows.length });
  } catch (err) {
    logger.error("indexer", "receive failed", err);
    return c.json({ error: "Receive failed" }, 500);
  } finally {
    try {
      attachedDb?.close();
    } catch { }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
  }
});

router.post("/api/indexer/clear", async (c) => {
  const limitRes = await _applyRateLimit(c);
  if (limitRes) return limitRes;
  const denied = await guardSettingsRoute(c, "POST /api/indexer/clear");
  if (denied) return denied;

  let body: { confirm?: boolean };
  try {
    body = await c.req.json<{ confirm?: boolean }>();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (body.confirm !== true) {
    return c.json({ error: "Confirmation required" }, 400);
  }

  try {
    clearAll();
    return c.json({ ok: true });
  } catch (err) {
    logger.error("indexer", "clear failed", err);
    return c.json({ error: "Clear failed" }, 500);
  }
});

export default router;
