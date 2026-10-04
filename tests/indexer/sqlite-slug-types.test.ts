import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SqliteAdapter } from "../../src/server/indexer/adapters/sqlite/adapter";
import type { IndexRow } from "../../src/server/indexer/recorders/default";

const TYPE = "Social Media";
const prevDir = process.env.DEGOOG_INDEXER_DIR;
let dir: string;

const row = (url: string, query: string): IndexRow => ({
  query_norm: query,
  engine_type: TYPE,
  url,
  url_norm: url.replace(/^https?:\/\//, ""),
  source_engine: "Test",
  title: `Title ${url}`,
  snippet: "",
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

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "degoog-sqlite-slug-"));
  process.env.DEGOOG_INDEXER_DIR = dir;
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.DEGOOG_INDEXER_DIR;
  else process.env.DEGOOG_INDEXER_DIR = prevDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("sqlite adapter with a type whose slug differs from its name", () => {
  test("writes and reads again after the type is cleared", async () => {
    const adapter = new SqliteAdapter();
    await adapter.writeBatch(TYPE, [row("https://a.example/1", "cats")], 1000, 10);
    expect(await adapter.countHitsForType(TYPE, undefined)).toBe(1);

    await adapter.clearType(TYPE);

    await adapter.writeBatch(TYPE, [row("https://b.example/2", "dogs")], 2000, 10);
    expect(await adapter.countHitsForType(TYPE, undefined)).toBe(1);
    expect(adapter.discoverTypes()).toContain("social-media");
    await adapter.close();
  });
});
