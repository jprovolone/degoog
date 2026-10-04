import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { clearPluginSettingsCache } from "../../src/server/utils/settings/plugin-settings";
import {
  getFaviconProviderMetas,
  hasFaviconProviders,
  initFavicon,
  runFaviconChain,
} from "../../src/server/extensions/favicon/registry";
import { ExtensionStoreType } from "../../src/server/types/extension";

const acceptFaviconResult = <T>(result: T): T => result;

type CallLog = { __faviconCalls: string[] };
const calls = (): string[] => (globalThis as unknown as CallLog).__faviconCalls;

const PROVIDERS: Record<string, string> = {
  alpha: `export default { name: "Alpha", async getFavicon(host) { globalThis.__faviconCalls.push("alpha"); return host === "alpha.test" ? { url: "https://alpha.test/icon.png" } : null; } };\n`,
  bravo: `export default class Bravo { name = "Bravo"; async getFavicon(host) { globalThis.__faviconCalls.push("bravo"); return host === "boom.test" ? null : { data: new Uint8Array([1, 2, 3]), contentType: "image/png" }; } }\n`,
  charlie: `export const provider = { name: "Charlie", async getFavicon() { globalThis.__faviconCalls.push("charlie"); throw new Error("charlie exploded"); } };\n`,
  delta: `export default { name: "Delta", async getFavicon() { globalThis.__faviconCalls.push("delta"); return { nope: true }; } };\n`,
  "not-a-provider": `export default { name: "Nope" };\n`,
};

let dir = "";
let settingsFile = "";
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["DEGOOG_FAVICON_DIR", "DEGOOG_PLUGIN_SETTINGS_FILE", "DEGOOG_DATA_DIR"];

async function writeSettings(settings: Record<string, Record<string, string>>): Promise<void> {
  await writeFile(settingsFile, JSON.stringify(settings));
  clearPluginSettingsCache();
  await initFavicon(true);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "degoog-favicon-reg-"));
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.DEGOOG_DATA_DIR = dir;
  process.env.DEGOOG_FAVICON_DIR = join(dir, "favicon");
  settingsFile = join(dir, "plugin-settings.json");
  process.env.DEGOOG_PLUGIN_SETTINGS_FILE = settingsFile;
  for (const [folder, body] of Object.entries(PROVIDERS)) {
    await mkdir(join(dir, "favicon", folder), { recursive: true });
    await writeFile(join(dir, "favicon", folder, "index.js"), body);
  }
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  clearPluginSettingsCache();
  await initFavicon(true);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  (globalThis as unknown as CallLog).__faviconCalls = [];
});

describe("favicon registry", () => {
  test("loads only modules exporting name and getFavicon, under canonical favicon ids", async () => {
    await writeSettings({});
    const metas = await getFaviconProviderMetas();
    expect(metas.map((m) => m.id)).toEqual([
      "alpha-favicon",
      "bravo-favicon",
      "charlie-favicon",
      "delta-favicon",
    ]);
    expect(metas.every((m) => m.type === ExtensionStoreType.Favicon)).toBe(true);
    expect(metas[0].settingsSchema.map((f) => f.key)).toEqual(["outgoingTransport"]);
    expect(hasFaviconProviders()).toBe(true);
  });

  test("tries providers one at a time in priority order and stops at the first hit", async () => {
    await writeSettings({
      "alpha-favicon": { priority: "3" },
      "bravo-favicon": { priority: "1" },
      "charlie-favicon": { priority: "2" },
      "delta-favicon": { priority: "0" },
    });
    expect(await runFaviconChain("alpha.test", acceptFaviconResult)).toEqual({ url: "https://alpha.test/icon.png" });
    expect(calls()).toEqual(["alpha"]);

    const hit = await runFaviconChain("other.test", acceptFaviconResult);
    expect(hit).toEqual({ data: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect(calls()).toEqual(["alpha", "alpha", "charlie", "bravo"]);
  });

  test("a throwing provider or an invalid result does not break the chain", async () => {
    await writeSettings({
      "charlie-favicon": { priority: "9" },
      "delta-favicon": { priority: "8" },
      "alpha-favicon": { priority: "7" },
      "bravo-favicon": { priority: "6" },
    });
    expect(await runFaviconChain("alpha.test", acceptFaviconResult)).toEqual({ url: "https://alpha.test/icon.png" });
    expect(calls()).toEqual(["charlie", "delta", "alpha"]);
  });

  test("disabled providers are skipped and returning null everywhere yields null", async () => {
    await writeSettings({
      "bravo-favicon": { priority: "5" },
      "alpha-favicon": { disabled: "true", priority: "9" },
    });
    expect(await runFaviconChain("boom.test", acceptFaviconResult)).toBeNull();
    expect(calls()).toEqual(["bravo", "charlie", "delta"]);
  });

  test("providers without a priority run after every ranked provider, even priority 0", async () => {
    await writeSettings({
      "delta-favicon": { priority: "0" },
    });
    expect(await runFaviconChain("boom.test", acceptFaviconResult)).toBeNull();
    expect(calls()).toEqual(["delta", "alpha", "bravo", "charlie"]);
  });

  test("a result rejected by accept falls through to the next provider", async () => {
    await writeSettings({
      "alpha-favicon": { priority: "3" },
      "charlie-favicon": { priority: "2" },
      "bravo-favicon": { priority: "1" },
      "delta-favicon": { priority: "0" },
    });
    const accepted = await runFaviconChain("alpha.test", (result) =>
      "url" in result ? null : result.contentType,
    );
    expect(accepted).toBe("image/png");
    expect(calls()).toEqual(["alpha", "charlie", "bravo"]);
  });

  test("hasFaviconProviders is false once every provider is disabled", async () => {
    await writeSettings({
      "alpha-favicon": { disabled: "true" },
      "bravo-favicon": { disabled: "true" },
      "charlie-favicon": { disabled: "true" },
      "delta-favicon": { disabled: "true" },
    });
    expect(hasFaviconProviders()).toBe(false);
    expect(await runFaviconChain("alpha.test", acceptFaviconResult)).toBeNull();
    expect(calls()).toEqual([]);
  });
});
