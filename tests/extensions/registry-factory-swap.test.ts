import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRegistry } from "../../src/server/extensions/registry-factory";

type Widget = { id: string };

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "degoog-registry-swap-"));
  for (const id of ["alpha", "beta"]) {
    writeFileSync(join(dir, `${id}.ts`), `export const widget = { id: "${id}" };\n`);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const isWidget = (v: unknown): v is Widget =>
  typeof v === "object" && v !== null && typeof (v as Widget).id === "string";

describe("createRegistry reloads", () => {
  test("live items stay visible until the new set is complete", async () => {
    const waiting: (() => void)[] = [];
    let gated = false;
    const registry = createRegistry<Widget>({
      dirs: () => [{ dir }],
      match: (mod) => (isWidget(mod.widget) ? { ...mod.widget } : null),
      onLoad: async () => {
        if (gated) await new Promise<void>((r) => waiting.push(r));
      },
      allowFlatFiles: true,
      debugTag: "test-swap",
    });

    await registry.init();
    expect(registry.items().map((w) => w.id)).toEqual(["alpha", "beta"]);

    gated = true;
    const reloading = registry.reload();
    await new Promise((r) => setTimeout(r, 20));
    expect(registry.items().map((w) => w.id)).toEqual(["alpha", "beta"]);

    gated = false;
    for (const release of waiting) release();
    await reloading;
    expect(registry.items().map((w) => w.id)).toEqual(["alpha", "beta"]);
  });

  test("overlapping reloads that dedupe through reset never end up empty", async () => {
    const seen = new Set<string>();
    const registry = createRegistry<Widget>({
      dirs: () => [{ dir }],
      match: (mod) => (isWidget(mod.widget) ? { ...mod.widget } : null),
      reset: () => seen.clear(),
      onLoad: async (w) => {
        if (seen.has(w.id)) return false;
        seen.add(w.id);
      },
      allowFlatFiles: true,
      debugTag: "test-dedupe",
    });

    await Promise.all([registry.init(), registry.reload(), registry.refresh()]);
    expect(registry.items().map((w) => w.id)).toEqual(["alpha", "beta"]);
  });
});
