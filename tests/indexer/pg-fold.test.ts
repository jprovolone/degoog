import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import { PgAdapter } from "../../src/server/indexer/adapters/postgres/adapter";
import { initPgSchema } from "../../src/server/indexer/adapters/postgres/schema";
import { writePgRows } from "../../src/server/indexer/adapters/postgres/statements";
import type { IndexRow } from "../../src/server/indexer/recorders/default";

const PG_URL = process.env.DEGOOG_TEST_POSTGRES;
const TYPE = `foldtest${Date.now()}`;

const row = (url: string, title: string, snippet = "", query = "seed"): IndexRow => ({
  query_norm: query,
  engine_type: TYPE,
  url,
  url_norm: url,
  source_engine: "TestEngine",
  title,
  snippet,
  thumbnail: null,
  image_url: null,
  is_gif: null,
  duration: null,
  extras_json: null,
  position: 1,
  sources_json: null,
  filters_json: null,
  meta_json: null,
});

const OLD_ROWS = [
  row("https://example.org/flore", "Café de Flore", "historic café in paris"),
  row("https://example.org/rust", "The Rust Book", "learn rust programming"),
  row("https://example.org/rust2", "Rust by Example", "rust examples"),
  row("https://example.org/zh", "中文搜索引擎 很好", ""),
];

const urlsOf = (rows: { url: string }[]): string[] => rows.map((r) => r.url).sort();

describe.skipIf(!PG_URL)("postgres accent-insensitive search on an existing install", () => {
  const sql = PG_URL ? postgres(PG_URL, { max: 2, onnotice: () => {} }) : null;
  let adapter: PgAdapter;
  let englishBefore: string[] = [];
  let oldSnapshot: unknown = [];

  const waitForFold = async (): Promise<void> => {
    const ready = (adapter as unknown as { _foldReady: Set<string> })._foldReady;
    for (let i = 0; i < 100 && !ready.has(TYPE); i++) await Bun.sleep(50);
    expect(ready.has(TYPE)).toBe(true);
  };

  beforeAll(async () => {
    await sql!.begin(async (tx) => {
      await initPgSchema(tx, TYPE);
      await writePgRows(tx, TYPE, OLD_ROWS, 1000, 10);
    });
    oldSnapshot = [...await sql!`
      SELECT url, title, snippet, first_seen, last_seen, search_vec::text AS vec
      FROM ${sql!(TYPE)}.urls ORDER BY url
    `];

    const legacy = new PgAdapter(PG_URL!);
    await legacy.boot();
    (legacy as unknown as { _foldReady: Set<string> })._foldReady.clear();
    englishBefore = urlsOf(await legacy.queryFuzzy(TYPE, "rust", 30));
    await legacy.close();

    adapter = new PgAdapter(PG_URL!);
    await adapter.boot();
    await waitForFold();
  });

  afterAll(async () => {
    await adapter?.clearType(TYPE);
    await adapter?.close();
    await sql?.end();
  });

  test("boot adds the column without touching existing rows", async () => {
    const after = await sql!`
      SELECT url, title, snippet, first_seen, last_seen, search_vec::text AS vec
      FROM ${sql!(TYPE)}.urls ORDER BY url
    `;
    expect([...after]).toEqual([...(oldSnapshot as object[])]);
    const [{ filled }] = await sql!<{ filled: number }[]>`
      SELECT COUNT(search_fold)::int AS filled FROM ${sql!(TYPE)}.urls
    `;
    expect(filled).toBe(0);
  });

  test("the accent-insensitive index is valid", async () => {
    const rows = await sql!<{ indisvalid: boolean }[]>`
      SELECT i.indisvalid FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${TYPE} AND c.relname LIKE '%_urls_fold'
    `;
    expect([...rows]).toEqual([{ indisvalid: true }]);
  });

  test("english fuzzy results are unchanged", async () => {
    expect(urlsOf(await adapter.queryFuzzy(TYPE, "rust", 30))).toEqual(englishBefore);
    expect(englishBefore).toEqual(["https://example.org/rust", "https://example.org/rust2"]);
  });

  test("old accented rows still match their exact spelling", async () => {
    expect(urlsOf(await adapter.queryFuzzy(TYPE, "café", 30))).toContain("https://example.org/flore");
  });

  test("old rows that were never seen again stay accent-sensitive", async () => {
    expect(urlsOf(await adapter.queryFuzzy(TYPE, "cafe", 30))).not.toContain("https://example.org/flore");
  });

  test("new rows match with or without accents", async () => {
    await adapter.writeBatch(TYPE, [row("https://example.org/creme", "Crème brûlée recipe")], 2000, 10);
    for (const q of ["creme brulee", "crème brûlée", "creme"]) {
      expect(urlsOf(await adapter.queryFuzzy(TYPE, q, 30))).toContain("https://example.org/creme");
    }
  });

  test("an old row seen again becomes accent-insensitive", async () => {
    await adapter.writeBatch(TYPE, [row("https://example.org/flore", "Café de Flore", "historic café in paris", "flore")], 3000, 10);
    expect(urlsOf(await adapter.queryFuzzy(TYPE, "cafe", 30))).toContain("https://example.org/flore");
    const [kept] = await sql!<{ title: string; first_seen: string }[]>`
      SELECT title, first_seen::text FROM ${sql!(TYPE)}.urls WHERE url = 'https://example.org/flore'
    `;
    expect(kept).toEqual({ title: "Café de Flore", first_seen: "1000" });
  });

  test("a shorter title seen later keeps the stored text searchable without accents", async () => {
    const url = "https://example.org/laduree";
    await adapter.writeBatch(TYPE, [row(url, "Pâtisserie Ladurée macarons parisiens")], 4000, 10);
    await adapter.writeBatch(TYPE, [row(url, "Ladurée", "", "laduree")], 5000, 10);
    const [stored] = await sql!<{ title: string }[]>`
      SELECT title FROM ${sql!(TYPE)}.urls WHERE url = ${url}
    `;
    expect(stored.title).toBe("Pâtisserie Ladurée macarons parisiens");
    expect(urlsOf(await adapter.queryFuzzy(TYPE, "patisserie", 30))).toContain(url);
  });

  test("a second boot is a no-op", async () => {
    const again = new PgAdapter(PG_URL!);
    await again.boot();
    const indexes = await sql!<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM pg_indexes WHERE schemaname = ${TYPE} AND indexname LIKE '%_urls_fold'
    `;
    expect([...indexes]).toEqual([{ c: 1 }]);
    await again.close();
  });

  test("words inside an unbroken cjk run are found by substring", async () => {
    expect(urlsOf(await adapter.querySubstring(TYPE, "搜索", ["搜索"], 30))).toContain("https://example.org/zh");
    expect(await adapter.querySubstring(TYPE, "猫咪", ["猫咪"], 30)).toEqual([]);
  });
});
