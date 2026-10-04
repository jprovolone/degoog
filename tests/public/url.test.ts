import { describe, test, expect, beforeAll } from "bun:test";
import { buildSearchUrl } from "../../src/client/utils/net/url";
import { state } from "../../src/client/state";

const withBase = (base: string, fn: () => void): void => {
  const g = globalThis as unknown as { window: { __DEGOOG_BASE_URL__?: string } };
  const prev = g.window.__DEGOOG_BASE_URL__;
  g.window.__DEGOOG_BASE_URL__ = base;
  try {
    fn();
  } finally {
    g.window.__DEGOOG_BASE_URL__ = prev;
  }
};

describe("public/url", () => {
  beforeAll(() => {
    const g = globalThis as unknown as { window?: { __DEGOOG_BASE_URL__?: string } };
    if (!g.window) g.window = {};
    g.window.__DEGOOG_BASE_URL__ = "";
  });

  test("buildSearchUrl includes query and engine params", () => {
    state.currentTimeFilter = "any";
    const out = buildSearchUrl("test query", { duckduckgo: true }, "all", 1);
    expect(out).toContain("/api/search");
    expect(out).toContain("q=test+query");
    expect(out).toContain("duckduckgo=true");
  });

  test("buildSearchUrl prefixes with the configured base url", () => {
    withBase("/degoog", () => {
      state.currentTimeFilter = "any";
      const out = buildSearchUrl("test query", { duckduckgo: true }, "all", 1);
      expect(out.startsWith("/degoog/api/search?")).toBe(true);
    });
  });
});
