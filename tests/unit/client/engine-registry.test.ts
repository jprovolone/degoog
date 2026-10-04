import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { installClientEnv } from "../../helpers/client-env";

type GetRegistry = typeof import("../../../src/client/utils/search/engines").getRegistry;

const REGISTRY = { engines: [{ id: "alpha-engine" }], defaults: {} };

let restoreEnv: () => void;
let getRegistry: GetRegistry;
const savedFetch = globalThis.fetch;

const stubFetch = (responses: Array<() => Promise<Response>>): { calls: number } => {
  const counter = { calls: 0 };
  globalThis.fetch = (() => {
    const next = responses[counter.calls] ?? responses[responses.length - 1];
    counter.calls++;
    return next();
  }) as unknown as typeof fetch;
  return counter;
};

beforeAll(async () => {
  restoreEnv = installClientEnv();
  ({ getRegistry } = await import("../../../src/client/utils/search/engines"));
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

afterAll(() => {
  restoreEnv();
});

describe("engine registry fetch", () => {
  test("retries after network and non-ok failures instead of caching them", async () => {
    const counter = stubFetch([
      async () => {
        throw new TypeError("offline");
      },
      async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      async () => new Response(JSON.stringify(REGISTRY), { status: 200 }),
    ]);

    await expect(getRegistry()).rejects.toThrow("offline");
    await expect(getRegistry()).rejects.toThrow("500");
    const reg = await getRegistry();

    expect(reg.engines.map((e) => e.id)).toEqual(["alpha-engine"]);
    expect(counter.calls).toBe(3);
  });
});
