import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { renderTemplateString } from "../../src/shared/template/index";
import { installClientEnv } from "../helpers/client-env";
import type { ScoredResult } from "../../src/shared/search-types";

const RESULT_TEMPLATE = readFileSync(
  join(
    import.meta.dir,
    "../../src/public/themes/degoog-theme/search-templates/result.html",
  ),
  "utf-8",
);

const SIGNED = "/api/proxy/favicon?domain=example.test&sig=abc";

const baseContext = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  index: 3,
  title: "Example",
  url: "https://example.test/",
  cite_url: "example.test/",
  snippet: "snippet",
  favicon_url: SIGNED,
  favicon_host: "example.test",
  favicon_missing: false,
  favicon_missing_tip: "",
  sources: [],
  show_actions: false,
  action_block: false,
  action_replace: false,
  action_score: false,
  action_refresh: false,
  ...over,
});

const render = (over: Record<string, unknown> = {}): string =>
  renderTemplateString(RESULT_TEMPLATE, baseContext(over));

describe("result template favicon slot", () => {
  test("renders a lazy favicon image from the signed url", () => {
    const html = render();
    expect(html).toContain('class="result-favicon degoog-result--favicon"');
    expect(html).toContain(`src="${SIGNED.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("result-favicon-missing");
  });

  test("renders the placeholder with a tooltip and no image when no provider is installed", () => {
    const html = render({
      favicon_url: "",
      favicon_missing: true,
      favicon_missing_tip: "No favicon extension installed",
    });
    expect(html).toContain(
      'class="result-favicon-missing degoog-result--favicon-missing"',
    );
    expect(html).toContain('data-tooltip="No favicon extension installed"');
    expect(html).toContain("fa-ghost");
    expect(html).not.toContain('class="result-favicon degoog-result--favicon"');
    expect(html).not.toContain("/api/proxy/favicon");
  });
});

describe("result template refresh action", () => {
  test("shows the refresh item only when action_refresh is set", () => {
    const withRefresh = render({ show_actions: true, action_refresh: true });
    expect(withRefresh).toContain('id="result-action-refresh-3"');
    const withoutRefresh = render({ show_actions: true, action_block: true });
    expect(withoutRefresh).toContain('id="result-action-block-3"');
    expect(withoutRefresh).not.toContain("result-action-refresh-");
  });
});

describe("client result context", () => {
  type ContextWindow = {
    __DEGOOG_RESULT_ACTIONS__?: Record<string, boolean>;
    __DEGOOG_FAVICONS__?: { providers: boolean };
  };
  let restore: () => void;
  let buildResultContext: (r: ScoredResult, index?: number) => Record<string, unknown>;

  const win = (): ContextWindow =>
    (globalThis as unknown as { window: ContextWindow }).window;

  const result: ScoredResult = {
    title: "Example",
    url: "https://www.example.test/page",
    snippet: "snippet",
    source: "engine",
    score: 1,
    sources: ["engine"],
    favicon: SIGNED,
  };

  beforeAll(async () => {
    restore = installClientEnv();
    ({ buildResultContext } = await import("../../src/client/modules/renderer/render"));
  });

  afterAll(() => restore());

  test("uses the server signed favicon and never builds one from the url", () => {
    win().__DEGOOG_FAVICONS__ = { providers: true };
    win().__DEGOOG_RESULT_ACTIONS__ = {};
    const ctx = buildResultContext(result, 0);
    expect(ctx.favicon_url).toBe(SIGNED);
    expect(ctx.favicon_missing).toBe(false);
    expect(ctx.favicon_missing_tip).toBe("");
    expect(buildResultContext({ ...result, favicon: undefined }).favicon_url).toBe("");
  });

  test("flags the placeholder when no favicon provider is installed", () => {
    win().__DEGOOG_FAVICONS__ = { providers: false };
    win().__DEGOOG_RESULT_ACTIONS__ = {};
    const ctx = buildResultContext(result, 0);
    expect(ctx.favicon_url).toBe("");
    expect(ctx.favicon_missing).toBe(true);
    expect(ctx.favicon_missing_tip).toBe("search-templates.result.favicon-missing");
  });

  test("gates the refresh action on auth and the refresh flag", () => {
    win().__DEGOOG_FAVICONS__ = { providers: true };
    const cases: [Record<string, boolean>, boolean][] = [
      [{ authenticated: true, refresh: true }, true],
      [{ authenticated: false, refresh: true }, false],
      [{ authenticated: true, refresh: false }, false],
    ];
    for (const [flags, expected] of cases) {
      win().__DEGOOG_RESULT_ACTIONS__ = flags;
      const ctx = buildResultContext(result, 0);
      expect(ctx.action_refresh).toBe(expected);
      expect(ctx.show_actions).toBe(expected);
    }
  });
});
