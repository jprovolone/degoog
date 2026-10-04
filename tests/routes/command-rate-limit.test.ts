import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { BangCommand } from "../../src/server/types/extension";

const REGISTRY_MOD = "../../src/server/extensions/commands/registry";
const SEARCH_UTILS_MOD = "../../src/server/utils/search";
const registryReal = { ...(await import(REGISTRY_MOD)) };
const searchUtilsReal = { ...(await import(SEARCH_UTILS_MOD)) };

let executed = 0;
let limiterCalls = 0;
let command: BangCommand;

const makeCommand = (respectRateLimiting?: boolean): BangCommand => ({
  name: "Probe",
  description: "probe",
  trigger: "probe",
  ...(respectRateLimiting === undefined ? {} : { respectRateLimiting }),
  execute: async () => {
    executed++;
    return { title: "probe", html: "<p>probe</p>" };
  },
});

let router: { request: (req: Request | string) => Response | Promise<Response> };

beforeAll(async () => {
  mock.module(REGISTRY_MOD, () => ({
    ...registryReal,
    matchBangCommand: () => ({
      type: "command",
      command,
      commandId: "probe-command",
      args: "",
    }),
  }));
  mock.module(SEARCH_UTILS_MOD, () => ({
    ...searchUtilsReal,
    _applyRateLimit: async () => {
      limiterCalls++;
      return new Response("slow down", { status: 429 });
    },
  }));
  router = (await import("../../src/server/routes/extensions/commands")).default;
});

afterAll(() => {
  mock.module(REGISTRY_MOD, () => registryReal);
  mock.module(SEARCH_UTILS_MOD, () => searchUtilsReal);
});

beforeEach(() => {
  executed = 0;
  limiterCalls = 0;
});

describe("command bangs and rate limiting", () => {
  test.each([[undefined], [false]])(
    "respectRateLimiting=%p keeps today's behaviour: no rate limit",
    async (flag) => {
      command = makeCommand(flag);
      const res = await router.request("http://localhost/api/command?q=!probe");
      expect(res.status).toBe(200);
      expect(limiterCalls).toBe(0);
      expect(executed).toBe(1);
    },
  );

  test("respectRateLimiting=true runs the search rate limit before execute", async () => {
    command = makeCommand(true);
    const res = await router.request("http://localhost/api/command?q=!probe");
    expect(res.status).toBe(429);
    expect(limiterCalls).toBe(1);
    expect(executed).toBe(0);
  });

  test("a command that throws answers with a json 500", async () => {
    command = {
      ...makeCommand(),
      execute: async () => {
        throw new Error("boom");
      },
    };
    const res = await router.request("http://localhost/api/command?q=!probe");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Command failed" });
  });

  test("the built-in !ip command opts in", async () => {
    const ip = (await import("../../src/server/extensions/commands/builtins/ip")).default;
    expect(ip.respectRateLimiting).toBe(true);
  });
});
