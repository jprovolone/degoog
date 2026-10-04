import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  faviconDefaultId,
  runFaviconDefaultsMigration093026,
  type FaviconMigrationDeps,
} from "../../src/server/migrations/2026-09-favicon-defaults-migration";
import { clearPluginSettingsCache } from "../../src/server/utils/settings/plugin-settings";

const GOOGLE = "favicon/google";
const DUCK = "favicon/duckduckgo";
const GOOGLE_ID = "degoog-org-official-extensions-google-favicon";
const DUCK_ID = "degoog-org-official-extensions-duckduckgo-favicon";

const dir = mkdtempSync(join(tmpdir(), "degoog-favicon-mig-"));
const settingsFile = join(dir, "plugin-settings.json");
const saved = {
  data: process.env.DEGOOG_DATA_DIR,
  settings: process.env.DEGOOG_PLUGIN_SETTINGS_FILE,
};
process.env.DEGOOG_DATA_DIR = dir;
process.env.DEGOOG_PLUGIN_SETTINGS_FILE = settingsFile;

afterAll(() => {
  if (saved.data === undefined) delete process.env.DEGOOG_DATA_DIR;
  else process.env.DEGOOG_DATA_DIR = saved.data;
  if (saved.settings === undefined) delete process.env.DEGOOG_PLUGIN_SETTINGS_FILE;
  else process.env.DEGOOG_PLUGIN_SETTINGS_FILE = saved.settings;
  clearPluginSettingsCache();
  rmSync(dir, { recursive: true, force: true });
});

type FakeStore = {
  deps: FaviconMigrationDeps;
  installed: Set<string>;
  installs: string[];
  ensures: number;
  reloads: number;
  failing: Set<string>;
};

const fakeStore = (preinstalled: string[] = []): FakeStore => {
  const state: FakeStore = {
    installed: new Set(preinstalled),
    installs: [],
    ensures: 0,
    reloads: 0,
    failing: new Set(),
    deps: {} as FaviconMigrationDeps,
  };
  state.deps = {
    ensureOfficialRepo: async () => {
      state.ensures++;
    },
    isInstalled: async (itemPath) => state.installed.has(itemPath),
    install: async (itemPath) => {
      state.installs.push(itemPath);
      if (state.failing.has(itemPath)) throw new Error(`clone of ${itemPath} failed`);
      state.installed.add(itemPath);
    },
    reload: async () => {
      state.reloads++;
    },
  };
  return state;
};

const seedSettings = (settings: Record<string, unknown> | null): void => {
  if (settings === null) rmSync(settingsFile, { force: true });
  else writeFileSync(settingsFile, JSON.stringify(settings));
  clearPluginSettingsCache();
};

const readSettings = (): Record<string, unknown> =>
  JSON.parse(readFileSync(settingsFile, "utf-8")) as Record<string, unknown>;

beforeEach(() => seedSettings({ __schemaVersion: 52028 }));

describe("favicon defaults migration 93026", () => {
  test("default ids are the canonical official favicon ids", () => {
    expect(faviconDefaultId(GOOGLE)).toBe(GOOGLE_ID);
    expect(faviconDefaultId(DUCK)).toBe(DUCK_ID);
  });

  test("installs google then duckduckgo once, ranks google first and bumps the version", async () => {
    const store = fakeStore();
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.ensures).toBe(1);
    expect(store.installs).toEqual([GOOGLE, DUCK]);
    expect(store.reloads).toBe(1);
    const out = readSettings();
    expect(out.__schemaVersion).toBe(93026);
    expect(out[GOOGLE_ID]).toEqual({ priority: "1" });
    expect(out[DUCK_ID]).toEqual({ priority: "0" });
  });

  test("does not rerun after the bump even when the user uninstalled both", async () => {
    const store = fakeStore();
    await runFaviconDefaultsMigration093026(store.deps);
    store.installed.clear();
    clearPluginSettingsCache();

    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.installs).toEqual([GOOGLE, DUCK]);
    expect(store.ensures).toBe(1);
  });

  test("an install failure leaves the version alone so the next boot retries", async () => {
    const store = fakeStore();
    store.failing.add(DUCK);
    await runFaviconDefaultsMigration093026(store.deps);

    expect(readSettings().__schemaVersion).toBe(52028);
    expect(store.reloads).toBe(0);

    store.failing.clear();
    clearPluginSettingsCache();
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.installs).toEqual([GOOGLE, DUCK, DUCK]);
    expect(readSettings().__schemaVersion).toBe(93026);
  });

  test("a retry after a partial failure never reinstalls a provider the admin removed", async () => {
    const store = fakeStore();
    store.failing.add(DUCK);
    await runFaviconDefaultsMigration093026(store.deps);
    expect(store.installed.has(GOOGLE)).toBe(true);

    store.installed.delete(GOOGLE);
    store.failing.clear();
    clearPluginSettingsCache();
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.installs).toEqual([GOOGLE, DUCK, DUCK]);
    expect(store.installed.has(GOOGLE)).toBe(false);
    expect(readSettings().__schemaVersion).toBe(93026);
  });

  test("a failing official repo bootstrap never throws and does not bump", async () => {
    const store = fakeStore();
    store.deps.ensureOfficialRepo = async () => {
      throw new Error("git missing");
    };
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.installs).toEqual([]);
    expect(readSettings().__schemaVersion).toBe(52028);
  });

  test("skips already installed items and keeps an existing priority", async () => {
    seedSettings({ __schemaVersion: 52028, [GOOGLE_ID]: { priority: "7" } });
    const store = fakeStore([GOOGLE]);
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.installs).toEqual([DUCK]);
    const out = readSettings();
    expect(out[GOOGLE_ID]).toEqual({ priority: "7" });
    expect(out[DUCK_ID]).toEqual({ priority: "0" });
    expect(out.__schemaVersion).toBe(93026);
  });

  test("skips when the canonical ids migration has not finished", async () => {
    for (const settings of [{ __schemaVersion: 52027 }, { "some-engine": { enabled: "true" } }]) {
      seedSettings(settings);
      const store = fakeStore();
      await runFaviconDefaultsMigration093026(store.deps);

      expect(store.ensures).toBe(0);
      expect(store.installs).toEqual([]);
      expect(readSettings()).toEqual(settings);
    }
  });

  test("a fresh instance with no settings file installs and creates the file", async () => {
    seedSettings(null);
    const store = fakeStore();
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.installs).toEqual([GOOGLE, DUCK]);
    expect(existsSync(settingsFile)).toBe(true);
    expect(readSettings().__schemaVersion).toBe(93026);
  });

  test("an unreadable settings file is kept aside and nothing is installed", async () => {
    writeFileSync(settingsFile, "{ not json");
    clearPluginSettingsCache();
    const store = fakeStore();
    await runFaviconDefaultsMigration093026(store.deps);

    expect(store.ensures).toBe(0);
    const kept = readdirSync(dir).filter((f) => f.startsWith("plugin-settings.json.corrupt-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, kept[0]), "utf-8")).toBe("{ not json");
    rmSync(join(dir, kept[0]));
  });
});
