import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { faviconDbPath, SqliteFaviconStore } from "../../src/server/indexer/adapters/sqlite/favicons";
import { PgFaviconStore, FAVICON_PG_SCHEMA } from "../../src/server/indexer/adapters/postgres/favicons";
import { DAY_MS, isRowFresh } from "../../src/server/indexer/types/favicons";
import { faviconStoreConfig } from "../../src/server/indexer/config/favicons";
import { leasePgPool } from "../../src/server/indexer/db/pg-pool";
import { ICO_BYTES, PNG_BYTES } from "../helpers/favicon-fixtures";

const PG_URL = process.env.DEGOOG_TEST_POSTGRES;

let dir = "";
const savedIndexerDir = process.env.DEGOOG_INDEXER_DIR;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "degoog-favicon-store-"));
  process.env.DEGOOG_INDEXER_DIR = dir;
});

afterAll(() => {
  if (savedIndexerDir === undefined) delete process.env.DEGOOG_INDEXER_DIR;
  else process.env.DEGOOG_INDEXER_DIR = savedIndexerDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("sqlite favicon store", () => {
  let store: SqliteFaviconStore;

  afterEach(async () => {
    await store?.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${faviconDbPath()}${suffix}`, { force: true });
  });

  test("lives next to the indexer dbs without looking like one", async () => {
    store = new SqliteFaviconStore();
    await store.init();
    expect(faviconDbPath()).toBe(join(dir, "favicon.db"));
    expect(existsSync(faviconDbPath())).toBe(true);
    const db = new Database(faviconDbPath(), { readonly: true });
    const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    const { journal_mode: mode } = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();
    expect(version).toBe(2);
    expect(mode).toBe("wal");
  });

  test("round trips icons", async () => {
    store = new SqliteFaviconStore();
    const now = Date.now();
    await store.put({ key: "k-png", mime: "image/png", data: PNG_BYTES, fetchedAt: now });
    const png = await store.get("k-png");
    expect(png?.mime).toBe("image/png");
    expect(Array.from(png?.data ?? [])).toEqual(Array.from(PNG_BYTES));
    expect(png?.fetchedAt).toBe(now);
    expect(await store.get("nope")).toBeNull();
    expect(await store.stats()).toEqual({ rows: 1, bytes: PNG_BYTES.byteLength });
  });

  test("miss rows left by the first schema are purged on open", async () => {
    const legacy = new Database(faviconDbPath(), { create: true });
    legacy.exec("CREATE TABLE icons (key TEXT PRIMARY KEY, mime TEXT, data BLOB, fetched_at INTEGER NOT NULL)");
    legacy.query("INSERT INTO icons (key, mime, data, fetched_at) VALUES (?, ?, ?, ?)").run("k-miss", null, null, Date.now());
    legacy.query("INSERT INTO icons (key, mime, data, fetched_at) VALUES (?, ?, ?, ?)").run("k-png", "image/png", PNG_BYTES, Date.now());
    legacy.exec("PRAGMA user_version = 1");
    legacy.close();
    store = new SqliteFaviconStore();
    await store.init();
    expect(await store.get("k-miss")).toBeNull();
    expect((await store.get("k-png"))?.mime).toBe("image/png");
    expect(await store.stats()).toEqual({ rows: 1, bytes: PNG_BYTES.byteLength });
  });

  test("put replaces and delete removes", async () => {
    store = new SqliteFaviconStore();
    await store.put({ key: "k", mime: "image/png", data: PNG_BYTES, fetchedAt: 1 });
    await store.put({ key: "k", mime: "image/x-icon", data: ICO_BYTES, fetchedAt: 2 });
    expect((await store.get("k"))?.mime).toBe("image/x-icon");
    await store.delete("k");
    expect(await store.get("k")).toBeNull();
  });

  test("prune drops old icons", async () => {
    store = new SqliteFaviconStore();
    const now = Date.now();
    await store.put({ key: "fresh", mime: "image/png", data: PNG_BYTES, fetchedAt: now });
    await store.put({ key: "old", mime: "image/png", data: PNG_BYTES, fetchedAt: now - 31 * DAY_MS });
    expect(await store.prune(30)).toBe(1);
    expect(await store.get("fresh")).not.toBeNull();
    expect(await store.get("old")).toBeNull();
  });
});

describe("favicon store settings", () => {
  test("the store only runs while the indexer runs", () => {
    expect(faviconStoreConfig({}).enabled).toBe(false);
    expect(faviconStoreConfig({ degoogIndexerEnabled: "true" }).enabled).toBe(true);
    expect(
      faviconStoreConfig({ degoogIndexerEnabled: "true", degoogFaviconStoreEnabled: "false" }).enabled,
    ).toBe(false);
    expect(faviconStoreConfig({ degoogFaviconStoreEnabled: "true" }).enabled).toBe(false);
  });

  test("max age defaults to 30 and clamps to 1..3650", () => {
    expect(faviconStoreConfig({}).maxAgeDays).toBe(30);
    expect(faviconStoreConfig({ degoogFaviconStoreMaxAgeDays: "0" }).maxAgeDays).toBe(1);
    expect(faviconStoreConfig({ degoogFaviconStoreMaxAgeDays: "99999" }).maxAgeDays).toBe(3650);
    expect(faviconStoreConfig({ degoogFaviconStoreMaxAgeDays: "junk" }).maxAgeDays).toBe(30);
  });

  test("row freshness follows the same cutoffs as prune", () => {
    const now = Date.now();
    expect(isRowFresh({ key: "k", mime: "image/png", data: PNG_BYTES, fetchedAt: now - 29 * DAY_MS }, 30, now)).toBe(true);
    expect(isRowFresh({ key: "k", mime: "image/png", data: PNG_BYTES, fetchedAt: now - 31 * DAY_MS }, 30, now)).toBe(false);
  });
});

describe("shared postgres pool", () => {
  const FAKE_URL = "postgres://degoog:nope@127.0.0.1:1/degoog";

  test("leases on the same connection share one pool until the last release", async () => {
    const indexer = leasePgPool(FAKE_URL);
    const favicon = leasePgPool(FAKE_URL);
    expect(favicon.sql).toBe(indexer.sql);
    await indexer.release();
    await indexer.release();
    const late = leasePgPool(FAKE_URL);
    expect(late.sql).toBe(favicon.sql);
    await favicon.release();
    await late.release();
    const fresh = leasePgPool(FAKE_URL);
    expect(fresh.sql).not.toBe(indexer.sql);
    await fresh.release();
  });
});

describe.skipIf(!PG_URL)("postgres favicon store", () => {
  let store: PgFaviconStore;

  beforeAll(async () => {
    store = new PgFaviconStore(PG_URL!);
    await store.init();
  });

  afterAll(async () => {
    const lease = leasePgPool(PG_URL!);
    await lease.sql`DROP SCHEMA IF EXISTS ${lease.sql(FAVICON_PG_SCHEMA)} CASCADE`;
    await store.close();
    await lease.release();
  });

  test("round trips, prunes and never shows up as an indexer type", async () => {
    const now = Date.now();
    await store.put({ key: "pg-png", mime: "image/png", data: PNG_BYTES, fetchedAt: now });
    await store.put({ key: "pg-old", mime: "image/png", data: PNG_BYTES, fetchedAt: now - 31 * DAY_MS });
    expect(Array.from((await store.get("pg-png"))?.data ?? [])).toEqual(Array.from(PNG_BYTES));
    expect((await store.get("pg-png"))?.fetchedAt).toBe(now);
    expect(await store.prune(30)).toBe(1);
    expect((await store.stats()).rows).toBe(1);
    const lease = leasePgPool(PG_URL!);
    const urls = await lease.sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = ${FAVICON_PG_SCHEMA} AND table_name = 'urls'
    `;
    await lease.release();
    expect(urls.length).toBe(0);
  });
});
