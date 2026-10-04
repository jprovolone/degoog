import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { Hono } from "hono";
import { themesDir } from "../../src/server/utils/paths";
import * as baseUrlReal from "../../src/server/utils/net/base-url";

const BASE_URL_MOD = "../../src/server/utils/net/base-url";
const realBaseUrl = { ...baseUrlReal };
const BASE = "/degoog";
const THEME_FOLDER = "base-path-theme";

let themeDir: string;
let app: Hono;

beforeAll(async () => {
  themeDir = join(themesDir(), THEME_FOLDER);
  await mkdir(join(themeDir, "images"), { recursive: true });
  await writeFile(join(themeDir, "images", "bg.png"), "fake-png-bytes");

  mock.module(BASE_URL_MOD, () => ({
    ...realBaseUrl,
    getBasePath: () => BASE,
    getBaseUrl: () => BASE,
  }));
  const mod = await import("../../src/server/routes/extensions/plugin-assets");
  app = new Hono().route(BASE, mod.default);
});

afterAll(async () => {
  mock.module(BASE_URL_MOD, () => realBaseUrl);
  await rm(themeDir, { recursive: true, force: true });
});

describe("routes/plugin-assets under a base path", () => {
  test("theme assets resolve when mounted below DEGOOG_BASE_URL", async () => {
    const res = await app.request(
      `http://localhost${BASE}/themes/${THEME_FOLDER}/images/bg.png`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fake-png-bytes");
  });

  test("traversal is still refused below a base path", async () => {
    const res = await app.request(
      `http://localhost${BASE}/themes/${THEME_FOLDER}/%2e%2e%2f%2e%2e%2fpackage.json`,
    );
    expect(res.status).toBe(404);
  });
});
