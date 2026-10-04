import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { FaviconResult } from "../../src/server/types/extension";
import { fakeFaviconProviders, restoreFaviconProviders } from "../helpers/favicon-providers";
import { isolateFaviconEnv, type IsolatedEnv } from "../helpers/favicon-env";
import { PNG_BYTES } from "../helpers/favicon-fixtures";

let env: IsolatedEnv;
let answer: (host: string) => FaviconResult = () => null;
let chainCalls: string[] = [];

const settings = await import("../../src/server/utils/settings/server-settings");
const { initServerKey } = await import("../../src/server/utils/security/server-key");
const { buildFaviconUrl, signResultThumbnails } = await import("../../src/server/utils/net/proxy-sign");
const { clearRateLimitState } = await import("../../src/server/utils/security/rate-limit");
const { compatLayer } = await import("../../src/server/extensions/compatibility-layer/registry");
const { coerceSetting, SETTINGS_SCHEMA } = await import("../../src/server/utils/settings/settings-schema");
const proxyRouter = (await import("../../src/server/routes/proxy")).default;
const faviconRouter = (await import("../../src/server/routes/favicon")).default;

const proxyGet = async (path: string): Promise<Response> =>
  proxyRouter.request(new Request(`http://localhost${path}`));

const refresh = async (body: unknown): Promise<Response> =>
  faviconRouter.request(
    new Request("http://localhost/api/favicon/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  env = isolateFaviconEnv("degoog-favicon-routes-");
  settings.clearServerSettingsCache();
  await settings.setInstanceSettings({});
  await initServerKey();
  fakeFaviconProviders(true, async (host) => {
    chainCalls.push(host);
    return answer(host);
  });
});

afterAll(async () => {
  restoreFaviconProviders();
  await settings.setInstanceSettings({});
  settings.clearServerSettingsCache();
  env.restore();
});

beforeEach(() => {
  chainCalls = [];
  answer = () => ({ data: PNG_BYTES, contentType: "image/png" });
  clearRateLimitState();
});

describe("GET /api/proxy/favicon", () => {
  test("a bad domain is a 400", async () => {
    expect((await proxyGet("/api/proxy/favicon?domain=a%20b&sig=00")).status).toBe(400);
    expect((await proxyGet("/api/proxy/favicon")).status).toBe(400);
  });

  test("an unsigned or mis-signed request is a 403 and never runs the chain", async () => {
    expect((await proxyGet("/api/proxy/favicon?domain=example.test")).status).toBe(403);
    expect((await proxyGet("/api/proxy/favicon?domain=example.test&sig=deadbeef")).status).toBe(403);
    const other = new URL(`http://x${buildFaviconUrl("other.test")}`).searchParams.get("sig");
    expect((await proxyGet(`/api/proxy/favicon?domain=example.test&sig=${other}`)).status).toBe(403);
    expect(chainCalls).toEqual([]);
  });

  test("a signed request gets validated bytes with locked down headers", async () => {
    const res = await proxyGet(buildFaviconUrl("signed.test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(PNG_BYTES));
  });

  test("a signed request with no icon anywhere is a 404", async () => {
    answer = () => null;
    expect((await proxyGet(buildFaviconUrl("missing.test"))).status).toBe(404);
  });

  test("the cache buster does not break the signature", async () => {
    expect((await proxyGet(buildFaviconUrl("busted.test", 1234))).status).toBe(200);
  });
});

describe("buildFaviconUrl and result signing", () => {
  test("no providers or no host means no url", () => {
    expect(buildFaviconUrl("")).toBe("");
    fakeFaviconProviders(false);
    try {
      expect(buildFaviconUrl("example.test")).toBe("");
      const [result] = signResultThumbnails([
        { title: "t", url: "https://example.test/", snippet: "", source: "e", score: 1, sources: [] },
      ]);
      expect(result.favicon).toBe("");
    } finally {
      fakeFaviconProviders(true, async (host) => {
        chainCalls.push(host);
        return answer(host);
      });
    }
  });

  test("every result gets a signed favicon, one signature per host", () => {
    const results = signResultThumbnails([
      { title: "a", url: "https://example.test/a", snippet: "", source: "e", score: 1, sources: [] },
      { title: "b", url: "https://example.test/b", snippet: "", source: "e", score: 1, sources: [] },
      { title: "c", url: "https://other.test/", snippet: "", source: "e", score: 1, sources: [] },
      { title: "d", url: "not a url", snippet: "", source: "e", score: 1, sources: [] },
    ]);
    expect(results[0].favicon).toBe(buildFaviconUrl("example.test"));
    expect(results[1].favicon).toBe(results[0].favicon);
    expect(results[2].favicon).toBe(buildFaviconUrl("other.test"));
    expect(results[0].favicon).toContain("&sig=");
    expect(results[3].favicon).toBe("");
  });
});

describe("favicon urls outside the result list", () => {
  test("compat catalog items carry a signed favicon for their site", async () => {
    const items = await compatLayer("4get")!.listItems();
    const withSite = items.find((item) => item.site);
    expect(withSite).toBeDefined();
    expect(withSite!.favicon).toBe(buildFaviconUrl(new URL(withSite!.site!).hostname));
    expect(withSite!.favicon).toContain("&sig=");
  });

  test("favicon store settings are coerced and clamped on save", () => {
    expect(coerceSetting(SETTINGS_SCHEMA.degoogFaviconStoreEnabled, "false")).toBe(false);
    expect(coerceSetting(SETTINGS_SCHEMA.degoogFaviconStoreEnabled, "true")).toBe(true);
    expect(coerceSetting(SETTINGS_SCHEMA.degoogFaviconStoreMaxAgeDays, "0")).toBe("1");
    expect(coerceSetting(SETTINGS_SCHEMA.degoogFaviconStoreMaxAgeDays, "90000")).toBe("3650");
    expect(coerceSetting(SETTINGS_SCHEMA.degoogFaviconStoreMaxAgeDays, "45.7")).toBe("45");
    expect(coerceSetting(SETTINGS_SCHEMA.degoogFaviconStoreMaxAgeDays, "junk")).toBe("30");
  });
});

describe("POST /api/favicon/refresh", () => {
  beforeAll(() => {
    process.env.DEGOOG_DANGEROUSLY_NO_PASSWORD = "true";
  });

  afterAll(() => {
    delete process.env.DEGOOG_DANGEROUSLY_NO_PASSWORD;
  });

  test("rejects bodies without a usable domain", async () => {
    expect((await refresh("nope")).status).toBe(400);
    expect((await refresh({})).status).toBe(400);
    expect((await refresh({ domain: 42 })).status).toBe(400);
    expect((await refresh({ domain: "bad host!" })).status).toBe(400);
  });

  test("reruns the chain and hands back a cache busted signed url", async () => {
    await proxyGet(buildFaviconUrl("again.test"));
    const res = await refresh({ domain: "again.test" });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string | null };
    expect(url).toStartWith("/api/proxy/favicon?domain=again.test&sig=");
    expect(url).toMatch(/&v=\d+$/);
    expect(chainCalls).toEqual(["again.test", "again.test"]);
    expect((await proxyGet(url!)).status).toBe(200);
  });

  test("answers null when nothing has an icon", async () => {
    answer = () => null;
    const res = await refresh({ domain: "empty.test" });
    expect(await res.json()).toEqual({ url: null });
  });

  test("is rate limited", async () => {
    answer = () => null;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await refresh({ domain: "spam.test" })).status);
    expect(statuses).toContain(429);
  });
});
