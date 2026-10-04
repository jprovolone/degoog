import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { SearchEngine } from "../../src/server/types/extension";
import type { SearchResult } from "../../src/shared/search-types";
import { THREAT_LEVEL } from "../../src/server/utils/security/sentinel";

const REGISTRY_MOD = "../../src/server/extensions/engines/catalog";
const ENGINE_CACHE_MOD = "../../src/server/search/engine-cache";

const registryReal = { ...(await import(REGISTRY_MOD)) };
const engineCacheReal = { ...(await import(ENGINE_CACHE_MOD)) };

const ENGINE_NAME = "Flaky Cache Engine";

const HIT: SearchResult = {
  title: "still here",
  url: "https://example.test/a",
  snippet: "the engine ran anyway",
  source: ENGINE_NAME,
};

let swallowAbort: AbortController | null = null;

const engine: SearchEngine = {
  name: ENGINE_NAME,
  executeSearch: async () => {
    if (!swallowAbort) return [HIT];
    swallowAbort.abort();
    return [];
  },
};

let keyFails = false;
let readFails = false;
let saved = 0;

let searchSingleEngine: typeof import("../../src/server/search").searchSingleEngine;

describe("searchSingleEngine cache isolation", () => {
  beforeAll(async () => {
    mock.module(REGISTRY_MOD, () => ({
      ...registryReal,
      getEngineMap: () => ({ flaky: engine }),
      getEngineIdByInstance: () => undefined,
    }));
    mock.module(ENGINE_CACHE_MOD, () => ({
      ...engineCacheReal,
      isCacheable: () => true,
      runKey: async () => {
        if (keyFails) throw new Error("fingerprint exploded");
        return "flaky-key";
      },
      readRun: async () => {
        if (readFails) throw new Error("valkey said no");
        return null;
      },
      saveRun: async () => {
        saved += 1;
      },
    }));
    searchSingleEngine = (await import("../../src/server/search")).searchSingleEngine;
  });

  afterAll(() => {
    mock.module(REGISTRY_MOD, () => registryReal);
    mock.module(ENGINE_CACHE_MOD, () => engineCacheReal);
  });

  test("runs the engine when the cache key blows up and skips the write", async () => {
    keyFails = true;
    readFails = false;
    saved = 0;
    const run = await searchSingleEngine("flaky", "hello");
    expect(run.results).toEqual([HIT]);
    expect(run.timing.status).toBe(THREAT_LEVEL.OK);
    expect(saved).toBe(0);
  });

  test("runs the engine when the cache read blows up and still writes", async () => {
    keyFails = false;
    readFails = true;
    saved = 0;
    const run = await searchSingleEngine("flaky", "hello");
    expect(run.results).toEqual([HIT]);
    expect(run.timing.status).toBe(THREAT_LEVEL.OK);
    expect(saved).toBe(1);
  });

  test("an engine that swallows the caller's abort and returns nothing is not cached", async () => {
    keyFails = false;
    readFails = false;
    saved = 0;
    swallowAbort = new AbortController();
    try {
      const run = await searchSingleEngine(
        "flaky", "hello", 1, "any", undefined, undefined, undefined, undefined, swallowAbort.signal,
      );
      expect(run.results).toEqual([]);
      expect(run.timing.status).toBeUndefined();
      expect(saved).toBe(0);
    } finally {
      swallowAbort = null;
    }
  });
});
