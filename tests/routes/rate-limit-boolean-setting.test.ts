import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

let app: Hono;
let savedSettingsFile: string | undefined;
let settings: typeof import("../../src/server/utils/settings/server-settings");
let clearRateLimitState: () => void;

const hit = async (): Promise<number> =>
  (await app.request("http://localhost/limited")).status;

beforeAll(async () => {
  savedSettingsFile = process.env.DEGOOG_SERVER_SETTINGS_FILE;
  process.env.DEGOOG_SERVER_SETTINGS_FILE = join(
    mkdtempSync(join(tmpdir(), "degoog-rate-limit-bool-")),
    "server-settings.json",
  );
  settings = await import("../../src/server/utils/settings/server-settings");
  ({ clearRateLimitState } = await import("../../src/server/utils/security/rate-limit"));
  const { _applyRateLimit } = await import("../../src/server/utils/search");
  app = new Hono();
  app.get("/limited", async (c) => (await _applyRateLimit(c)) ?? c.text("ok"));
});

beforeEach(() => {
  clearRateLimitState();
  settings.clearServerSettingsCache();
});

afterAll(() => {
  if (savedSettingsFile === undefined) delete process.env.DEGOOG_SERVER_SETTINGS_FILE;
  else process.env.DEGOOG_SERVER_SETTINGS_FILE = savedSettingsFile;
  settings.clearServerSettingsCache();
  clearRateLimitState();
});

describe("_applyRateLimit with schema-coerced settings", () => {
  test("a boolean true from the settings schema turns the limiter on", async () => {
    await settings.updateInstanceSettings({
      rateLimitEnabled: true,
      rateLimitBurstWindow: "60",
      rateLimitBurstMax: "2",
    });
    settings.clearServerSettingsCache();

    expect(await hit()).toBe(200);
    expect(await hit()).toBe(200);
    expect(await hit()).toBe(429);
  });

  test("the legacy string \"true\" still turns the limiter on", async () => {
    await settings.updateInstanceSettings({
      rateLimitEnabled: "true",
      rateLimitBurstWindow: "60",
      rateLimitBurstMax: "1",
    });
    settings.clearServerSettingsCache();

    expect(await hit()).toBe(200);
    expect(await hit()).toBe(429);
  });

  test("a boolean false leaves requests alone", async () => {
    await settings.updateInstanceSettings({
      rateLimitEnabled: false,
      rateLimitBurstWindow: "60",
      rateLimitBurstMax: "1",
    });
    settings.clearServerSettingsCache();

    for (let i = 0; i < 5; i++) expect(await hit()).toBe(200);
  });
});
