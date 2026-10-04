import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { PluginContext } from "../../src/server/types/extension";

const OUTGOING_MOD = "../../src/server/utils/net/outgoing";
const outgoingReal = { ...(await import(OUTGOING_MOD)) };
const { useCache, createCache } = await import("../../src/server/utils/cache/cache");

const outgoingUrls: string[] = [];
const globalUrls: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  mock.module(OUTGOING_MOD, () => ({
    ...outgoingReal,
    outgoingFetch: async (url: string) => {
      outgoingUrls.push(url);
      return Response.json({
        query: {
          pages: {
            "1": {
              pageid: 1,
              title: "Golden Retriever",
              extract: "A dog.",
              fullurl: "https://en.wikipedia.org/wiki/Golden_Retriever",
            },
          },
        },
      });
    },
  }));
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    globalUrls.push(String(input));
    throw new Error("global fetch must not be used");
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  mock.module(OUTGOING_MOD, () => outgoingReal);
});

describe("wikipedia knowledge panel", () => {
  test("reaches Wikipedia through the admin's outgoing transport, not the global fetch", async () => {
    const wiki = (await import("../../src/server/extensions/commands/builtins/wikipedia")).slot;
    wiki.init?.({
      template: "",
      useCache,
      createCache,
      signProxyUrl: (u: string) => u,
    } as unknown as PluginContext);
    expect(await wiki.trigger("golden retriever outgoing probe")).toBe(true);
    expect(outgoingUrls.some((u) => u.startsWith("https://en.wikipedia.org/w/api.php"))).toBe(true);
    expect(globalUrls).toEqual([]);
  });
});
