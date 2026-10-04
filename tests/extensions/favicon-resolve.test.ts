import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { FaviconResult } from "../../src/server/types/extension";
import { fakeFaviconProviders, restoreFaviconProviders } from "../helpers/favicon-providers";
import { isolateFaviconEnv, type IsolatedEnv } from "../helpers/favicon-env";
import { PNG_BYTES, SVG_BYTES } from "../helpers/favicon-fixtures";

let env: IsolatedEnv;
let chainCalls: string[] = [];
let answer: (host: string) => FaviconResult = () => null;

const settings = await import("../../src/server/utils/settings/server-settings");
const { initServerKey } = await import("../../src/server/utils/security/server-key");
const { resolveFaviconBytes, faviconRowKey } = await import("../../src/server/extensions/favicon/resolve");
const { closeFaviconStore, getFaviconStore } = await import("../../src/server/indexer/store/favicons");
const { useCache } = await import("../../src/server/utils/cache/cache");
const { forgetFaviconMisses } = await import("../../src/server/extensions/favicon/misses");
const { hasFaviconSource } = await import("../../src/server/extensions/favicon/source");
const { buildFaviconUrl } = await import("../../src/server/utils/net/proxy-sign");

beforeAll(async () => {
  env = isolateFaviconEnv("degoog-favicon-resolve-");
  settings.clearServerSettingsCache();
  await settings.setInstanceSettings({});
  await initServerKey();
  fakeFaviconProviders(true, async (host) => {
    chainCalls.push(host);
    await Bun.sleep(5);
    return answer(host);
  });
});

afterAll(async () => {
  await closeFaviconStore();
  restoreFaviconProviders();
  await settings.setInstanceSettings({});
  settings.clearServerSettingsCache();
  env.restore();
});

beforeEach(() => {
  chainCalls = [];
  answer = () => ({ data: PNG_BYTES, contentType: "image/svg+xml" });
});

describe("resolveFaviconBytes", () => {
  test("concurrent lookups for one host share a single chain run", async () => {
    const all = await Promise.all([
      resolveFaviconBytes("coalesce.test"),
      resolveFaviconBytes("coalesce.test"),
      resolveFaviconBytes("COALESCE.test"),
    ]);
    expect(chainCalls).toEqual(["coalesce.test"]);
    for (const icon of all) expect(icon?.contentType).toBe("image/png");
  });

  test("the content type comes from the bytes, not from the provider", async () => {
    const icon = await resolveFaviconBytes("sniffed.test");
    expect(icon?.contentType).toBe("image/png");
  });

  test("a cached icon is served without asking the providers again", async () => {
    await resolveFaviconBytes("cached.test");
    await resolveFaviconBytes("cached.test");
    expect(chainCalls).toEqual(["cached.test"]);
  });

  test("refresh drops the cached icon and asks again", async () => {
    await resolveFaviconBytes("refresh.test");
    answer = () => null;
    expect(await resolveFaviconBytes("refresh.test", { refresh: true })).toBeNull();
    expect(await resolveFaviconBytes("refresh.test")).toBeNull();
    expect(chainCalls).toEqual(["refresh.test", "refresh.test"]);
  });

  test("svg bytes are refused and the miss is remembered", async () => {
    answer = () => ({ data: SVG_BYTES, contentType: "image/png" });
    expect(await resolveFaviconBytes("svg.test")).toBeNull();
    expect(await resolveFaviconBytes("svg.test")).toBeNull();
    expect(chainCalls).toEqual(["svg.test"]);
  });

  test("a provider url pointing at a private address is never fetched", async () => {
    answer = () => ({ url: "http://127.0.0.1:9/favicon.png" });
    expect(await resolveFaviconBytes("ssrf.test")).toBeNull();
  });

  test("junk hosts never reach the providers", async () => {
    expect(await resolveFaviconBytes("../etc/passwd")).toBeNull();
    expect(await resolveFaviconBytes("")).toBeNull();
    expect(chainCalls).toEqual([]);
  });

  test("with no providers nothing runs and nothing is remembered", async () => {
    fakeFaviconProviders(false, async (host) => {
      chainCalls.push(host);
      return answer(host);
    });
    try {
      expect(await resolveFaviconBytes("none.test")).toBeNull();
      expect(chainCalls).toEqual([]);
    } finally {
      fakeFaviconProviders(true, async (host) => {
        chainCalls.push(host);
        return answer(host);
      });
    }
  });
});

describe("resolveFaviconBytes with the favicon store", () => {
  beforeAll(async () => {
    await settings.setInstanceSettings({ degoogIndexerEnabled: "true" });
  });

  afterAll(async () => {
    await settings.setInstanceSettings({});
  });

  test("icons are written back under a signed key and survive a cold cache", async () => {
    await resolveFaviconBytes("stored.test");
    const store = await getFaviconStore();
    expect(store).not.toBeNull();
    expect(await store!.get("stored.test")).toBeNull();
    const row = await store!.get(faviconRowKey("stored.test"));
    expect(row?.mime).toBe("image/png");
    await useCache("favicon", 1000).clear();
    answer = () => null;
    const icon = await resolveFaviconBytes("stored.test");
    expect(icon?.contentType).toBe("image/png");
    expect(chainCalls).toEqual(["stored.test"]);
  });

  test("misses never reach the store", async () => {
    answer = () => null;
    expect(await resolveFaviconBytes("miss.test")).toBeNull();
    expect(await (await getFaviconStore())!.get(faviconRowKey("miss.test"))).toBeNull();
  });

  test("a provider change clears remembered misses so the new chain gets asked", async () => {
    answer = () => null;
    expect(await resolveFaviconBytes("late.test")).toBeNull();
    expect(await resolveFaviconBytes("late.test")).toBeNull();
    expect(chainCalls).toEqual(["late.test"]);
    await forgetFaviconMisses();
    answer = () => ({ data: PNG_BYTES, contentType: "image/png" });
    expect((await resolveFaviconBytes("late.test"))?.contentType).toBe("image/png");
    expect(chainCalls).toEqual(["late.test", "late.test"]);
  });

  test("with every provider off, saved icons still show and a refresh keeps them", async () => {
    await resolveFaviconBytes("keep.test");
    await useCache("favicon", 1000).clear();
    fakeFaviconProviders(false, async (host) => {
      chainCalls.push(host);
      return answer(host);
    });
    try {
      expect(hasFaviconSource()).toBe(true);
      expect(buildFaviconUrl("keep.test")).toContain("domain=keep.test");
      chainCalls = [];
      expect((await resolveFaviconBytes("keep.test"))?.contentType).toBe("image/png");
      expect((await resolveFaviconBytes("keep.test", { refresh: true }))?.contentType).toBe("image/png");
      expect(await (await getFaviconStore())!.get(faviconRowKey("keep.test"))).not.toBeNull();
      expect(await resolveFaviconBytes("never-saved.test")).toBeNull();
      expect(chainCalls).toEqual([]);
    } finally {
      fakeFaviconProviders(true, async (host) => {
        chainCalls.push(host);
        return answer(host);
      });
    }
  });

  test("with every provider off and saved favicons off, there is no favicon url", async () => {
    fakeFaviconProviders(false);
    try {
      await settings.setInstanceSettings({ degoogIndexerEnabled: "true", degoogFaviconStoreEnabled: "false" });
      expect(hasFaviconSource()).toBe(false);
      expect(buildFaviconUrl("keep.test")).toBe("");
    } finally {
      await settings.setInstanceSettings({ degoogIndexerEnabled: "true" });
      fakeFaviconProviders(true, async (host) => {
        chainCalls.push(host);
        return answer(host);
      });
    }
  });

  test("the store stays closed while the indexer is off", async () => {
    await settings.setInstanceSettings({});
    expect(await getFaviconStore()).toBeNull();
    await settings.setInstanceSettings({ degoogIndexerEnabled: "true" });
  });
});
