import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadPluginAssets,
  prunePluginAssets,
  addPluginCss,
  getAllPluginCss,
  registerPluginScript,
  getPluginScriptFolders,
  getScriptFolderSource,
  buildRouteUrl,
  initPlugin,
} from "../src/server/utils/extension-support/plugin-assets";
import type { PluginContext } from "../src/server/types/extension";

describe("plugin-assets", () => {
  test("addPluginCss and getAllPluginCss", () => {
    addPluginCss("p1", ".p1 { color: red; }");
    addPluginCss("p2", ".p2 { color: blue; }");
    const all = getAllPluginCss();
    expect(all).toContain(".p1 { color: red; }");
    expect(all).toContain(".p2 { color: blue; }");
  });

  test("registered script folders are listed and keep their source", () => {
    registerPluginScript("builtin-folder", "builtin");
    registerPluginScript("user-folder", "plugin");
    expect(getPluginScriptFolders()).toContain("user-folder");
    expect(getScriptFolderSource("builtin-folder")).toBe("builtin");
    expect(getScriptFolderSource("user-folder")).toBe("plugin");
    expect(getScriptFolderSource("unregistered")).toBeNull();
  });

  test("pruning drops css and scripts of removed plugin folders only", async () => {
    const root = await mkdtemp(join(tmpdir(), "degoog-assets-"));
    const kept = join(root, "kept-plugin");
    const gone = join(root, "gone-plugin");
    for (const dir of [kept, gone]) {
      await mkdir(dir);
      await writeFile(join(dir, "script.js"), "");
    }
    await writeFile(join(gone, "style.css"), ".gone-css { color: red; }");
    await writeFile(join(kept, "style.css"), ".kept-css { color: red; }");
    await loadPluginAssets(kept, "kept-plugin", "kept-plugin-slot");
    await loadPluginAssets(gone, "gone-plugin", "gone-plugin-slot");
    registerPluginScript("builtin-only", "builtin");

    await rm(gone, { recursive: true, force: true });
    prunePluginAssets(root);

    expect(getAllPluginCss()).toContain(".kept-css");
    expect(getAllPluginCss()).not.toContain(".gone-css");
    expect(getScriptFolderSource("kept-plugin")).toBe("plugin");
    expect(getScriptFolderSource("gone-plugin")).toBeNull();
    expect(getScriptFolderSource("builtin-only")).toBe("builtin");
    await rm(root, { recursive: true, force: true });
  });
});

describe("plugin route identity", () => {
  const FOLDER = "degoog-org-official-extensions-jellyfin";

  test("buildRouteUrl joins paths and tolerates leading slashes", () => {
    expect(buildRouteUrl(FOLDER, "thumb")).toBe(`/api/plugin/${FOLDER}/thumb`);
    expect(buildRouteUrl(FOLDER, "/thumb")).toBe(`/api/plugin/${FOLDER}/thumb`);
    expect(buildRouteUrl(FOLDER)).toBe(`/api/plugin/${FOLDER}`);
  });

  test("initPlugin exposes pluginId/apiBase/routeUrl from folder, not settingsId", async () => {
    let captured: PluginContext | null = null;
    const plugin = {
      init: (ctx: PluginContext) => {
        captured = ctx;
      },
    };

    await initPlugin(plugin, "/tmp/whatever", "plugin-jellyfin", "", {
      pluginId: FOLDER,
    });

    expect(captured).not.toBeNull();
    const ctx = captured as unknown as PluginContext;
    expect(ctx.pluginId).toBe(FOLDER);
    expect(ctx.id).toBe(FOLDER);
    expect(ctx.apiBase).toBe(`/api/plugin/${FOLDER}`);
    expect(ctx.routeUrl("thumb")).toBe(`/api/plugin/${FOLDER}/thumb`);
    expect(ctx.pluginId).not.toBe("plugin-jellyfin");
  });
});
