import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isolateFaviconEnv, type IsolatedEnv } from "../../helpers/favicon-env";

let env: IsolatedEnv;

const settings = await import("../../../src/server/utils/settings/server-settings");
const { coerceSetting, SETTINGS_SCHEMA } = await import("../../../src/server/utils/settings/settings-schema");
const { faviconShapeAttr, getFaviconShape } = await import("../../../src/server/utils/settings/favicon-shape");
const { FaviconShape } = await import("../../../src/shared/favicon-shapes");

beforeAll(() => {
  env = isolateFaviconEnv("degoog-favicon-shape-");
  settings.clearServerSettingsCache();
});

afterAll(() => {
  settings.clearServerSettingsCache();
  env.restore();
});

describe("favicon shape", () => {
  test("defaults to circle when nothing is saved", async () => {
    await settings.setInstanceSettings({});
    expect(await getFaviconShape()).toBe(FaviconShape.Circle);
    expect(await faviconShapeAttr()).toBe(' data-favicon-shape="circle"');
  });

  test("uses the saved shape", async () => {
    await settings.setInstanceSettings({ faviconShape: "hexagon" });
    expect(await faviconShapeAttr()).toBe(' data-favicon-shape="hexagon"');
  });

  test("an unknown or hostile value never reaches the attribute", async () => {
    await settings.setInstanceSettings({ faviconShape: '"><script>' });
    expect(await faviconShapeAttr()).toBe(' data-favicon-shape="circle"');
  });

  test("the settings schema only accepts known shapes", () => {
    expect(coerceSetting(SETTINGS_SCHEMA.faviconShape, "star")).toBe("star");
    expect(coerceSetting(SETTINGS_SCHEMA.faviconShape, "blob")).toBe("circle");
  });
});
