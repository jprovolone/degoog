import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { settingsAuth } from "../../src/server/routes/_guards";

const ENV_KEYS = ["DEGOOG_SETTINGS_PASSWORDS", "DEGOOG_DANGEROUSLY_NO_PASSWORD", "DEGOOG_PUBLIC_INSTANCE"];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

const app = new Hono();
app.post("/api/store/install", settingsAuth("probe"), (c) => c.json({ ok: true }));

const install = (secFetchSite?: string): Promise<Response> | Response =>
  app.request(
    new Request("http://localhost/api/store/install", {
      method: "POST",
      headers: secFetchSite ? { "sec-fetch-site": secFetchSite } : {},
      body: "{}",
    }),
  );

beforeAll(() => {
  delete process.env.DEGOOG_SETTINGS_PASSWORDS;
  delete process.env.DEGOOG_PUBLIC_INSTANCE;
  process.env.DEGOOG_DANGEROUSLY_NO_PASSWORD = "true";
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("settings gate with no password configured", () => {
  test.each([["same-origin"], ["none"], [undefined]])(
    "Sec-Fetch-Site=%p still passes like before",
    async (site) => {
      expect((await install(site)).status).toBe(200);
    },
  );

  test("a cross-site browser request is refused", async () => {
    expect((await install("cross-site")).status).toBe(401);
  });
});
