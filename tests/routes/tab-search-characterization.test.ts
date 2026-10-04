import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { SearchEngine, SearchResultTab } from "../../src/server/types/extension";
import type { SearchResult } from "../../src/shared/search-types";

const ENGINES_MOD = "../../src/server/extensions/engines/catalog";
const ENGINE_SETTINGS_MOD = "../../src/server/extensions/engines/engine-settings";
const LOADER_MOD = "../../src/server/extensions/engines/loader";
const SETTINGS_MOD = "../../src/server/utils/settings/plugin-settings";
const TABS_MOD = "../../src/server/extensions/search-result-tabs/registry";
const SERVER_SETTINGS_MOD = "../../src/server/utils/settings/server-settings";

const enginesReal = { ...(await import(ENGINES_MOD)) };
const settingsReal = { ...(await import(SETTINGS_MOD)) };
const tabsReal = { ...(await import(TABS_MOD)) };
const serverSettingsReal = { ...(await import(SERVER_SETTINGS_MOD)) };
const engineSettingsReal = { ...(await import(ENGINE_SETTINGS_MOD)) };
const loaderReal = { ...(await import(LOADER_MOD)) };
const { clear: clearCaches } = await import("../../src/server/utils/cache/cache");
const { initServerKey } = await import("../../src/server/utils/security/server-key");

const FALLBACK_TAB_PAGES = 10;

type EngineEntry = { id: string; instance: SearchEngine };

type Harness = {
  engines?: EngineEntry[];
  tab?: SearchResultTab | null;
  disabled?: string[];
  settings?: Record<string, unknown>;
};

type TabSearchBody = {
  results: (SearchResult & { score: number; sources: string[] })[];
  totalPages: number;
  page: number;
  engineTimings: { name: string; time: number; resultCount: number }[];
  totalTime: number;
};

let requestedEngineTypes: string[] = [];
let requestedConfigs: (Record<string, boolean> | undefined)[] = [];
let disabledLookups: string[] = [];

const makeResult = (source: string, n: number): SearchResult => ({
  title: `${source} ${n}`,
  url: `https://${source.toLowerCase()}.test/${n}`,
  snippet: `${source} snippet ${n}`,
  source,
});

const makeResults = (source: string, count: number): SearchResult[] =>
  Array.from({ length: count }, (_unused, i) => makeResult(source, i + 1));

const makeEngine = (
  name: string,
  results: SearchResult[],
  declaredPages?: number,
): EngineEntry => ({
  id: `${name.toLowerCase()}-engine`,
  instance: {
    name,
    executeSearch: async (_query, _page, _timeFilter, context) => {
      if (declaredPages !== undefined)
        context?.pagination?.({ total: declaredPages });
      return results;
    },
  },
});

const makeBrokenEngine = (name: string): EngineEntry => ({
  id: `${name.toLowerCase()}-engine`,
  instance: {
    name,
    executeSearch: async () => {
      throw new Error(`${name} exploded`);
    },
  },
});

const harness = ({ engines = [], tab = null, disabled = [], settings = {} }: Harness) => {
  requestedEngineTypes = [];
  requestedConfigs = [];
  disabledLookups = [];
  mock.module(SERVER_SETTINGS_MOD, () => ({
    ...serverSettingsReal,
    getInstanceSettings: async () => settings,
  }));
  mock.module(ENGINES_MOD, () => ({
    ...enginesReal,
    getEnginesForCustomType: async (
      engineType: string,
      config?: Record<string, boolean>,
    ) => {
      requestedEngineTypes.push(engineType);
      requestedConfigs.push(config);
      return engines.filter((e) => config?.[e.id] !== false);
    },
    getEngineMap: () =>
      Object.fromEntries(engines.map((e) => [e.id, e.instance])),
    getEngineIdByInstance: (instance: SearchEngine) =>
      engines.find((e) => e.instance === instance)?.id,
    getEngineSettingsView: async () => ({}),
    getEngineDefaultTransport: () => undefined,
    getDefaultEngineConfig: () =>
      Object.fromEntries(engines.map((e) => [e.id, true])),
  }));
  mock.module(ENGINE_SETTINGS_MOD, () => ({
    ...engineSettingsReal,
    engineFullSchema: () => [],
  }));
  mock.module(LOADER_MOD, () => ({
    ...loaderReal,
    listEngineIds: () => engines.map((e) => e.id),
  }));
  mock.module(TABS_MOD, () => ({
    ...tabsReal,
    getSearchResultTabById: (id: string) =>
      tab && tab.id === id ? tab : null,
  }));
  mock.module(SETTINGS_MOD, () => ({
    ...settingsReal,
    isDisabled: async (id: string) => {
      disabledLookups.push(id);
      return disabled.includes(id);
    },
  }));
};

const call = async (
  queryString: string,
  init?: RequestInit,
): Promise<Response> => {
  const router = (await import("../../src/server/routes/search")).default;
  return router.request(
    new Request(`http://localhost/api/tab-search${queryString}`, init),
  );
};

const body = async (res: Response): Promise<TabSearchBody> =>
  (await res.json()) as TabSearchBody;

beforeAll(async () => {
  await initServerKey();
});

afterEach(async () => {
  await clearCaches();
  mock.module(ENGINE_SETTINGS_MOD, () => engineSettingsReal);
  mock.module(LOADER_MOD, () => loaderReal);
  mock.module(ENGINES_MOD, () => enginesReal);
  mock.module(SETTINGS_MOD, () => settingsReal);
  mock.module(TABS_MOD, () => tabsReal);
  mock.module(SERVER_SETTINGS_MOD, () => serverSettingsReal);
});

describe("GET /api/tab-search validation", () => {
  test.each([
    ["?q=cats"],
    ["?tab=engine:videos"],
    ["?tab=engine:videos&q=%20%20%20"],
  ])("%s returns 400", async (queryString) => {
    harness({});
    const res = await call(queryString);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing tab or q" });
  });

  test("unknown tab id returns 404", async () => {
    harness({});
    const res = await call("?tab=nope&q=cats");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tab not found" });
  });
});

describe("GET /api/tab-search engine fan-out", () => {
  test("merges every engine declaring the type like page one does and scores by position", async () => {
    harness({
      engines: [
        makeEngine("Alpha", makeResults("Alpha", 2)),
        makeEngine("Beta", makeResults("Beta", 1)),
      ],
    });

    const res = await call("?tab=engine:videos&q=cats&page=3");
    expect(res.status).toBe(200);
    const json = await body(res);

    expect(requestedEngineTypes).toEqual(["videos"]);
    expect(json.page).toBe(3);
    expect(json.results.map((r) => r.title)).toEqual([
      "Alpha 1",
      "Beta 1",
      "Alpha 2",
    ]);
    expect(json.results.map((r) => r.score)).toEqual([100, 99, 98]);
    expect(json.results.map((r) => r.sources)).toEqual([
      ["Alpha"],
      ["Beta"],
      ["Alpha"],
    ]);
    expect(json.engineTimings.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
    expect(json.engineTimings.map((t) => t.resultCount)).toEqual([2, 1]);
  });

  test("engine type is everything after the engine: prefix", async () => {
    harness({ engines: [] });
    const res = await call("?tab=engine:my:odd:type&q=cats");
    expect(res.status).toBe(200);
    expect(requestedEngineTypes).toEqual(["my:odd:type"]);
  });

  test("a bare engine: prefix is not a tab and answers 404", async () => {
    harness({ engines: [makeEngine("Alpha", makeResults("Alpha", 2))] });
    const res = await call("?tab=engine:&q=cats");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tab not found" });
    expect(requestedEngineTypes).toEqual([]);
  });

  test("a throwing engine does not fail the request and still reports a timing", async () => {
    harness({
      engines: [
        makeBrokenEngine("Boom"),
        makeEngine("Beta", makeResults("Beta", 2)),
      ],
    });

    const res = await call("?tab=engine:videos&q=cats");
    expect(res.status).toBe(200);
    const json = await body(res);

    expect(json.results.map((r) => r.title)).toEqual(["Beta 1", "Beta 2"]);
    expect(json.results.map((r) => r.score)).toEqual([100, 99]);
    expect(json.engineTimings.map((t) => t.name)).toEqual(["Boom", "Beta"]);
    expect(json.engineTimings[0].resultCount).toBe(0);
    expect(json.engineTimings[1].resultCount).toBe(2);
  });

  test("score never drops below 1 past the hundredth merged result", async () => {
    harness({ engines: [makeEngine("Alpha", makeResults("Alpha", 105))] });
    const res = await call("?tab=engine:videos&q=cats");
    const json = await body(res);

    expect(json.results).toHaveLength(105);
    expect(json.results[98].score).toBe(2);
    expect(json.results[99].score).toBe(1);
    expect(json.results[104].score).toBe(1);
  });
});

describe("GET /api/tab-search page totals", () => {
  test("agreed page total takes the highest declared total", async () => {
    harness({
      engines: [
        makeEngine("Alpha", makeResults("Alpha", 1), 5),
        makeEngine("Beta", makeResults("Beta", 1), 7),
      ],
    });
    const json = await body(await call("?tab=engine:videos&q=cats"));
    expect(json.totalPages).toBe(7);
  });

  test("one silent engine drops the whole agreement to the fallback", async () => {
    harness({
      engines: [
        makeEngine("Alpha", makeResults("Alpha", 1), 5),
        makeEngine("Beta", makeResults("Beta", 1)),
      ],
    });
    const json = await body(await call("?tab=engine:videos&q=cats"));
    expect(json.totalPages).toBe(FALLBACK_TAB_PAGES);
  });

  test("zero results keeps totalPages at 1 even when an engine declared more", async () => {
    harness({ engines: [makeEngine("Alpha", [], 9)] });
    const json = await body(await call("?tab=engine:videos&q=cats"));
    expect(json.results).toEqual([]);
    expect(json.totalPages).toBe(1);
  });
});

describe("GET /api/tab-search tab extensions", () => {
  const tabWithEngineType: SearchResultTab = {
    id: "vids-tab",
    name: "Vids",
    engineType: "videos",
    executeSearch: async () => ({
      results: makeResults("Vids", 2),
      totalPages: 4,
    }),
  };

  test("tab results land after engine results with offset scores and can raise totalPages", async () => {
    harness({
      engines: [makeEngine("Alpha", makeResults("Alpha", 2), 2)],
      tab: tabWithEngineType,
    });

    const json = await body(await call("?tab=vids-tab&q=cats"));

    expect(requestedEngineTypes).toEqual(["videos"]);
    expect(json.results.map((r) => r.title)).toEqual([
      "Alpha 1",
      "Alpha 2",
      "Vids 1",
      "Vids 2",
    ]);
    expect(json.results.map((r) => r.score)).toEqual([100, 99, 98, 97]);
    expect(json.results.map((r) => r.sources)).toEqual([
      ["Alpha"],
      ["Alpha"],
      ["Vids"],
      ["Vids"],
    ]);
    expect(json.engineTimings.map((t) => t.name)).toEqual(["Alpha", "Vids"]);
    expect(json.engineTimings[1].resultCount).toBe(2);
    expect(json.totalPages).toBe(4);
  });

  test("a lower tab totalPages does not lower the engine agreement", async () => {
    harness({
      engines: [makeEngine("Alpha", makeResults("Alpha", 1), 8)],
      tab: {
        id: "vids-tab",
        name: "Vids",
        engineType: "videos",
        executeSearch: async () => ({
          results: makeResults("Vids", 1),
          totalPages: 2,
        }),
      },
    });
    const json = await body(await call("?tab=vids-tab&q=cats"));
    expect(json.totalPages).toBe(8);
  });

  test("a tab with no engineType scores its own results from 100", async () => {
    harness({
      tab: {
        id: "solo-tab",
        name: "Solo",
        executeSearch: async () => ({
          results: makeResults("Solo", 3),
          totalPages: 6,
        }),
      },
    });

    const json = await body(await call("?tab=solo-tab&q=cats"));

    expect(requestedEngineTypes).toEqual([]);
    expect(json.results.map((r) => r.score)).toEqual([100, 99, 98]);
    expect(json.engineTimings.map((t) => t.name)).toEqual(["Solo"]);
    expect(json.totalPages).toBe(6);
  });

  test("a disabled tab extension is skipped entirely", async () => {
    harness({
      tab: {
        id: "solo-tab",
        name: "Solo",
        settingsId: "solo-tab",
        executeSearch: async () => ({ results: makeResults("Solo", 3) }),
      },
      disabled: ["solo-tab"],
    });

    const res = await call("?tab=solo-tab&q=cats");
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.results).toEqual([]);
    expect(json.engineTimings).toEqual([]);
    expect(json.totalPages).toBe(1);
  });

  test("a throwing tab extension does not take down the request", async () => {
    harness({
      engines: [makeEngine("Alpha", makeResults("Alpha", 2))],
      tab: {
        id: "vids-tab",
        name: "Vids",
        engineType: "videos",
        executeSearch: async () => {
          throw new Error("tab exploded");
        },
      },
    });

    const res = await call("?tab=vids-tab&q=cats");
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.results.map((r: { title: string }) => r.title)).toEqual([
      "Alpha 1",
      "Alpha 2",
    ]);
    const tabTiming = json.engineTimings.find(
      (t: { name: string }) => t.name === "Vids",
    );
    expect(tabTiming?.resultCount).toBe(0);
  });

  test("a throwing tab extension never leaks its error text to the client", async () => {
    harness({
      engines: [],
      tab: {
        id: "vids-tab",
        name: "Vids",
        engineType: "videos",
        executeSearch: async () => {
          throw new Error("internal secret detail");
        },
      },
    });

    const res = await call("?tab=vids-tab&q=cats");
    expect(await res.text()).not.toContain("internal secret detail");
  });

  test("a tab without settingsId is looked up by its id", async () => {
    harness({
      tab: {
        id: "solo-tab",
        name: "Solo",
        executeSearch: async () => ({ results: [] }),
      },
    });

    await call("?tab=solo-tab&q=cats");
    expect(disabledLookups).toEqual(["solo-tab"]);
  });
});

describe("GET /api/tab-search client ip", () => {
  const soloTab = (seen: { clientIp?: string }[]): SearchResultTab => ({
    id: "solo-tab",
    name: "Solo",
    executeSearch: async (_query, _page, context) => {
      seen.push({ clientIp: context?.clientIp });
      return { results: [] };
    },
  });

  test("clientIp is undefined when the proxy is not trusted", async () => {
    const seen: { clientIp?: string }[] = [];
    harness({ tab: soloTab(seen) });

    await call("?tab=solo-tab&q=cats", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    expect(seen).toEqual([{ clientIp: undefined }]);
  });

  test("the forwarded ip reaches the tab when the proxy is trusted", async () => {
    const previous = process.env.DEGOOG_DISTRUST_PROXY;
    process.env.DEGOOG_DISTRUST_PROXY = "false";
    try {
      const seen: { clientIp?: string }[] = [];
      harness({ tab: soloTab(seen) });

      await call("?tab=solo-tab&q=cats", {
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      });

      expect(seen).toEqual([{ clientIp: "203.0.113.9" }]);
    } finally {
      if (previous === undefined) delete process.env.DEGOOG_DISTRUST_PROXY;
      else process.env.DEGOOG_DISTRUST_PROXY = previous;
    }
  });
});

describe("/api/tab-search privacy parity with normal search", () => {
  type Seen = { query: string; time?: string; lang?: string; nsfw?: string };

  const trackingEngine = (seen: Seen[]): EngineEntry => ({
    id: "tracker-engine",
    instance: {
      name: "Tracker",
      executeSearch: async (query, _page, time, context) => {
        seen.push({
          query,
          time,
          lang: context?.lang,
          nsfw: context?.imageFilter?.nsfw,
        });
        return [
          {
            title: "<b>cats</b>",
            url: "https://news.test/a?utm_source=x&fbclid=y&id=1",
            snippet: "",
            source: "Tracker",
            thumbnail: "https://tse1.mm.bing.net/th?id=cats",
          },
        ];
      },
    },
  });

  test("runs the shared pipeline: ClearURLs, stripHtml, proxied thumbnails and sealed results", async () => {
    const seen: Seen[] = [];
    harness({ engines: [trackingEngine(seen)] });
    const json = await body(await call("?tab=engine:news&q=parity1"));
    const [r] = json.results as (SearchResult & { seal?: string })[];
    expect(r.url).toBe("https://news.test/a?id=1");
    expect(r.title).toBe("cats");
    expect(r.thumbnail).toStartWith("/api/proxy/image?url=");
    expect(typeof r.seal).toBe("string");
  });

  test("forwards language, time and safe mode to the engine", async () => {
    const seen: Seen[] = [];
    harness({ engines: [trackingEngine(seen)] });
    await call("?tab=engine:images&q=parity2&lang=de&time=week&safeMode=on");
    expect(seen).toEqual([
      { query: "parity2", time: "week", lang: "de", nsfw: "on" },
    ]);
  });

  test("never sends the query to an engine the visitor switched off", async () => {
    const seen: Seen[] = [];
    harness({ engines: [trackingEngine(seen)] });
    const json = await body(
      await call("?tab=engine:news&q=parity3&tracker-engine=false"),
    );
    expect(requestedConfigs[0]?.["tracker-engine"]).toBe(false);
    expect(seen).toEqual([]);
    expect(json.results).toEqual([]);
  });

  test("POST keeps the query out of the URL and honours the engine list", async () => {
    const seen: Seen[] = [];
    harness({ engines: [trackingEngine(seen)] });
    const res = await call("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tab: "engine:news",
        query: "parity4",
        engines: ["tracker-engine"],
        lang: "fr",
        page: 2,
      }),
    });
    expect(res.status).toBe(200);
    expect((await body(res)).page).toBe(2);
    expect(seen).toEqual([
      { query: "parity4", time: "any", lang: "fr", nsfw: undefined },
    ]);
  });

  test.each([["GET"], ["POST"]])(
    "%s enforces the search API key like /api/search",
    async (method) => {
      const seen: Seen[] = [];
      harness({
        engines: [trackingEngine(seen)],
        settings: { apiKeySearchEnabled: true },
      });
      const res =
        method === "GET"
          ? await call("?tab=engine:web&q=parity5")
          : await call("", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tab: "engine:web", query: "parity5" }),
            });
      expect(res.status).toBe(401);
      expect(seen).toEqual([]);
    },
  );

  test("plugin tab results get ClearURLs and stripHtml too", async () => {
    harness({
      tab: {
        id: "solo-tab",
        name: "Solo",
        executeSearch: async () => ({
          results: [
            {
              title: "<i>solo</i>",
              url: "https://solo.test/x?utm_medium=y&k=1",
              snippet: "",
              source: "Solo",
            },
          ],
        }),
      },
    });
    const [r] = (await body(await call("?tab=solo-tab&q=parity6"))).results;
    expect(r.url).toBe("https://solo.test/x?k=1");
    expect(r.title).toBe("solo");
  });
});
