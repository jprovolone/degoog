import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearServerSettingsCache } from "../../src/server/utils/settings/server-settings";

const SEARCH_MOD = "../../src/server/search/index";
const INTERCEPTS_MOD = "../../src/server/utils/extension-support/run-interceptors";
const searchReal = { ...(await import(SEARCH_MOD)) };
const interceptsReal = { ...(await import(INTERCEPTS_MOD)) };

const ENV_KEYS = ["DEGOOG_DATA_DIR", "DEGOOG_SERVER_SETTINGS_FILE", "DEGOOG_PLUGIN_SETTINGS_FILE"];
const savedEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
let tempDir = "";

type SearchCall = unknown[];
const searchCalls: SearchCall[] = [];
let overrides: Record<string, string> = {};
let router: { request: (req: Request | string) => Response | Promise<Response> };

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "degoog-lucky-"));
  process.env.DEGOOG_DATA_DIR = tempDir;
  process.env.DEGOOG_SERVER_SETTINGS_FILE = join(tempDir, "server-settings.json");
  process.env.DEGOOG_PLUGIN_SETTINGS_FILE = join(tempDir, "plugin-settings.json");
  writeFileSync(process.env.DEGOOG_SERVER_SETTINGS_FILE, JSON.stringify({ settings: {} }));
  writeFileSync(process.env.DEGOOG_PLUGIN_SETTINGS_FILE, "{}");
  clearServerSettingsCache();
  mock.module(SEARCH_MOD, () => ({
    ...searchReal,
    search: async (...args: unknown[]) => {
      searchCalls.push(args);
      return {
        query: String(args[0]),
        type: String(args[2]),
        totalTime: 0,
        engineTimings: [],
        relatedSearches: [],
        indexBasis: [],
        results: [{ title: "t", url: "https://lucky.test/1", snippet: "", source: "A", score: 1, sources: ["A"] }],
      };
    },
  }));
  mock.module(INTERCEPTS_MOD, () => ({
    ...interceptsReal,
    runIntercepts: async (query: string) => ({ query: `${query} rewritten`, overrides }),
  }));
  router = (await import("../../src/server/routes/search")).default;
});

afterAll(() => {
  mock.module(SEARCH_MOD, () => searchReal);
  mock.module(INTERCEPTS_MOD, () => interceptsReal);
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  clearServerSettingsCache();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("/api/lucky goes through the shared search request path", () => {
  test("GET passes filters and interceptor rewrites to search, then redirects", async () => {
    overrides = {};
    const res = await router.request(
      "http://localhost/api/lucky?q=rust&time=week&lang=de&dateFrom=2024-01-01&dateTo=2024-02-01&page=4&type=images",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://lucky.test/1");
    const [query, , type, page, time, lang, dateFrom, dateTo] = searchCalls[searchCalls.length - 1];
    expect([query, type, page, time, lang, dateFrom, dateTo]).toEqual([
      "rust rewritten",
      "web",
      1,
      "week",
      "de",
      "2024-01-01",
      "2024-02-01",
    ]);
  });

  test("POST form applies interceptor overrides for type, lang and time", async () => {
    overrides = { searchType: "news", lang: "fr", timeFilter: "day" };
    const res = await router.request(
      new Request("http://localhost/api/lucky", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: "rust", lang: "de", time: "week" }).toString(),
      }),
    );
    expect(res.status).toBe(302);
    const [, , type, page, time, lang] = searchCalls[searchCalls.length - 1];
    expect([type, page, time, lang]).toEqual(["news", 1, "day", "fr"]);
  });
});
