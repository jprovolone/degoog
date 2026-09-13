import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createRegistry, bumpPluginRegistryReload, getPluginRegistryReloadGeneration } from "../../src/server/extensions/registry-factory";

interface Widget {
  id: string;
}

describe("registry-factory onLoad contract", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "degoog-reg-"));
    await writeFile(
      join(dir, "alpha.ts"),
      `export const widget = { id: "alpha" };\n`,
    );
    await writeFile(
      join(dir, "beta.ts"),
      `export const widget = { id: "beta" };\n`,
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const build = (onLoad?: (w: Widget) => Promise<void | false>) =>
    createRegistry<Widget>({
      dirs: () => [{ dir }],
      match: (mod) => {
        const w = mod.widget as Widget | undefined;
        return w && typeof w.id === "string" ? w : null;
      },
      onLoad: onLoad
        ? async (w) => onLoad(w)
        : undefined,
      allowFlatFiles: true,
      debugTag: "test-widgets",
    });

  test("adds all items when onLoad returns void", async () => {
    const reg = build(async () => undefined);
    await reg.init();
    const ids = reg.items().map((w) => w.id).sort();
    expect(ids).toEqual(["alpha", "beta"]);
  });

  test("skips item when onLoad returns false", async () => {
    const reg = build(async (w) => (w.id === "beta" ? false : undefined));
    await reg.init();
    const ids = reg.items().map((w) => w.id);
    expect(ids).toEqual(["alpha"]);
  });

  test("bumpPluginRegistryReload increments import cache generation", () => {
    const before = getPluginRegistryReloadGeneration();
    bumpPluginRegistryReload();
    expect(getPluginRegistryReloadGeneration()).toBe(before + 1);
  });
});

describe("registry-factory reload freshness", () => {
  interface VersionedWidget {
    id: string;
    v: string;
  }

  let dir: string;

  const writeWidget = (name: string, v: string): Promise<void> =>
    writeFile(
      join(dir, name, "index.ts"),
      `export const widget = { id: "${name}", v: "${v}" };\n`,
    );

  const build = () =>
    createRegistry<VersionedWidget>({
      dirs: () => [{ dir }],
      match: (mod) => {
        const w = mod.widget as VersionedWidget | undefined;
        return w && typeof w.id === "string" ? w : null;
      },
      debugTag: "test-versioned-widgets",
    });

  const byId = (items: VersionedWidget[], id: string): VersionedWidget | undefined =>
    items.find((w) => w.id === id);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "degoog-reg-fresh-"));
    await mkdir(join(dir, "updated"));
    await mkdir(join(dir, "untouched"));
    await writeWidget("updated", "v1");
    await writeWidget("untouched", "v1");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reload picks up an updated extension and keeps untouched ones", async () => {
    const reg = build();
    await reg.init();
    const untouchedBefore = byId(reg.items(), "untouched");

    await writeWidget("updated", "v2-longer");
    await reg.reload();

    expect(byId(reg.items(), "updated")?.v).toBe("v2-longer");
    expect(byId(reg.items(), "untouched")).toBe(untouchedBefore);
  });

  test("refresh does not re-import changed files", async () => {
    const reg = build();
    await reg.init();
    const before = byId(reg.items(), "updated")?.v;

    await writeWidget("updated", "v3-even-longer");
    await reg.refresh();

    expect(byId(reg.items(), "updated")?.v).toBe(before);
  });
});
