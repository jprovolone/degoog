import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Transport } from "../../src/server/types/extension";
import type { SettingValue } from "../../src/server/utils/settings/plugin-settings";

const TRANSPORTS_MOD = "../../src/server/extensions/transports/registry";
const SETTINGS_MOD = "../../src/server/utils/settings/plugin-settings";
const OUTGOING_MOD = "../../src/server/utils/net/outgoing";
const transportsReal = { ...(await import(TRANSPORTS_MOD)) };
const settingsReal = { ...(await import(SETTINGS_MOD)) };
const outgoingReal = { ...(await import(OUTGOING_MOD)) };

const SAVED_ENV_KEYS = [
  "DEGOOG_DANGEROUSLY_NO_PASSWORD",
  "DEGOOG_PUBLIC_INSTANCE",
  "DEGOOG_SETTINGS_PASSWORDS",
] as const;
const savedEnv = new Map<string, string | undefined>();

const STORED: Record<string, SettingValue> = { host: "old.test", token: "stored-secret" };
const configured: Record<string, SettingValue>[] = [];
let configuredDuringFetch: Record<string, SettingValue> | undefined;

const fakeTransport = {
  name: "probe",
  settingsSchema: [
    { key: "host", label: "Host", type: "text" },
    { key: "token", label: "Token", type: "password", secret: true },
  ],
  configure: (settings: Record<string, SettingValue>) => {
    configured.push(settings);
  },
  available: () => true,
  fetch: async () => new Response("ok"),
} as unknown as Transport;

let router: { request: (req: Request | string) => Response | Promise<Response> };

beforeAll(async () => {
  for (const key of SAVED_ENV_KEYS) savedEnv.set(key, process.env[key]);
  delete process.env.DEGOOG_PUBLIC_INSTANCE;
  delete process.env.DEGOOG_SETTINGS_PASSWORDS;
  process.env.DEGOOG_DANGEROUSLY_NO_PASSWORD = "true";
  mock.module(TRANSPORTS_MOD, () => ({
    ...transportsReal,
    getTransport: (name: string) => (name === "probe" ? fakeTransport : undefined),
  }));
  mock.module(SETTINGS_MOD, () => ({
    ...settingsReal,
    getSettings: async () => ({ ...STORED }),
  }));
  mock.module(OUTGOING_MOD, () => ({
    ...outgoingReal,
    outgoingFetch: async () => {
      configuredDuringFetch = configured[configured.length - 1];
      return new Response("ok", { status: 200 });
    },
  }));
  router = (await import("../../src/server/routes/extensions/extensions")).default;
});

afterAll(() => {
  mock.module(TRANSPORTS_MOD, () => transportsReal);
  mock.module(SETTINGS_MOD, () => settingsReal);
  mock.module(OUTGOING_MOD, () => outgoingReal);
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/extensions/transports/:name/test", () => {
  test("tests with the stored secret the form left out, then restores saved settings", async () => {
    configured.length = 0;
    const res = await router.request(
      new Request("http://localhost/api/extensions/transports/probe/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: "new.test" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "OK (200)" });
    expect(configuredDuringFetch).toEqual({ host: "new.test", token: "stored-secret" });
    expect(configured[configured.length - 1]).toEqual(STORED);
  });
});
