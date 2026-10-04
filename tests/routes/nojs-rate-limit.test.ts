import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const SERVER_SETTINGS_MOD = "../../src/server/utils/settings/server-settings";
const SEARCH_UTILS_MOD = "../../src/server/utils/search";
const NOJS_RENDER_MOD = "../../src/server/nojs/render";
const serverSettingsReal = { ...(await import(SERVER_SETTINGS_MOD)) };
const searchUtilsReal = { ...(await import(SEARCH_UTILS_MOD)) };
const nojsRenderReal = { ...(await import(NOJS_RENDER_MOD)) };

beforeAll(() => {
  mock.module(SERVER_SETTINGS_MOD, () => ({
    ...serverSettingsReal,
    getInstanceSettings: async () => ({ nojsEnabled: "true" }),
  }));
  mock.module(SEARCH_UTILS_MOD, () => ({
    ...searchUtilsReal,
    _applyRateLimit: async () =>
      new Response("slow down", { status: 429, headers: { "Retry-After": "42" } }),
  }));
  mock.module(NOJS_RENDER_MOD, () => ({
    ...nojsRenderReal,
    getNojsTranslator: async () => () => "<b>slow & steady</b>",
  }));
});

afterAll(() => {
  mock.module(SERVER_SETTINGS_MOD, () => serverSettingsReal);
  mock.module(SEARCH_UTILS_MOD, () => searchUtilsReal);
  mock.module(NOJS_RENDER_MOD, () => nojsRenderReal);
});

describe("nojs rate limit page", () => {
  test("renders the translated message as text with the retry header", async () => {
    const router = (await import("../../src/server/nojs/router")).default;
    const res = await router.request("http://localhost/nojs/search?q=hello");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await res.text()).toBe(
      '<!doctype html><html><head><meta charset="UTF-8"><title>429</title></head><body><p>&lt;b&gt;slow &amp; steady&lt;/b&gt;</p></body></html>',
    );
  });
});
