import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const SERVER_SETTINGS_MOD = "../../src/server/utils/settings/server-settings";
const serverSettingsReal = { ...(await import(SERVER_SETTINGS_MOD)) };

let stored: Record<string, unknown> = {};
let router: { request: (req: Request | string) => Response | Promise<Response> };

beforeAll(async () => {
  mock.module(SERVER_SETTINGS_MOD, () => ({
    ...serverSettingsReal,
    getInstanceSettings: async () => stored,
  }));
  router = (await import("../../src/server/routes/settings/privacy-policy")).default;
});

afterAll(() => {
  mock.module(SERVER_SETTINGS_MOD, () => serverSettingsReal);
});

describe("GET /api/privacy-policy", () => {
  test("anyone can read the admin's policy as markdown", async () => {
    stored = { privacyPolicy: "  ## We keep nothing\n\nReally.  " };
    const res = await router.request("http://localhost/api/privacy-policy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: "## We keep nothing\n\nReally." });
  });

  test("an unset policy is an empty string, not an error", async () => {
    stored = {};
    const res = await router.request("http://localhost/api/privacy-policy");
    expect(await res.json()).toEqual({ markdown: "" });
  });
});
