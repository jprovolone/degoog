import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearPluginSettingsCache,
  didSettingsLoadFail,
  getSettings,
  setSettings,
} from "../../../src/server/utils/settings/plugin-settings";

const prevFile = process.env.DEGOOG_PLUGIN_SETTINGS_FILE;
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "plugin-settings-"));
  file = join(dir, "plugin-settings.json");
  process.env.DEGOOG_PLUGIN_SETTINGS_FILE = file;
  clearPluginSettingsCache();
});

afterAll(() => {
  if (prevFile === undefined) delete process.env.DEGOOG_PLUGIN_SETTINGS_FILE;
  else process.env.DEGOOG_PLUGIN_SETTINGS_FILE = prevFile;
  clearPluginSettingsCache();
});

describe("plugin-settings persistence", () => {
  test("a corrupt file is moved aside before the next write lands", async () => {
    await writeFile(file, "{ not json");

    expect(await getSettings("a-engine")).toEqual({});
    expect(didSettingsLoadFail()).toBe(true);

    await setSettings("b-engine", { disabled: "true" });

    const kept = (await readdir(dir)).filter((f) => f.includes(".corrupt-"));
    expect(kept).toHaveLength(1);
    expect(await readFile(join(dir, kept[0]), "utf-8")).toBe("{ not json");
    expect(didSettingsLoadFail()).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  test("concurrent writes to different ids all survive", async () => {
    await writeFile(file, JSON.stringify({ keep: { v: "1" } }));

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => setSettings(`id-${i}`, { n: String(i) })),
    );
    clearPluginSettingsCache();

    const onDisk = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
    expect(onDisk.keep).toEqual({ v: "1" });
    for (let i = 0; i < 20; i++) expect(onDisk[`id-${i}`]).toEqual({ n: String(i) });
    await rm(dir, { recursive: true, force: true });
  });
});
