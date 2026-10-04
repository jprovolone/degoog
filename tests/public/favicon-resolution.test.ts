import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installClientEnv } from "../helpers/client-env";

type Listener = () => void;

class FakeImage {
  classes = new Set<string>();
  complete: boolean;
  naturalWidth: number;
  onerror: (() => void) | null = null;
  private _load: Listener | null = null;

  constructor(complete: boolean, naturalWidth: number) {
    this.complete = complete;
    this.naturalWidth = naturalWidth;
  }

  classList = {
    toggle: (name: string, on: boolean): void => {
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    },
    remove: (name: string): void => {
      this.classes.delete(name);
    },
  };

  getAttribute(name: string): string | null {
    return name === "src" ? "/api/proxy/favicon?domain=example.test&sig=abc" : null;
  }

  addEventListener(type: string, fn: Listener): void {
    if (type === "load") this._load = fn;
  }

  finishLoading(naturalWidth: number): void {
    this.complete = true;
    this.naturalWidth = naturalWidth;
    this._load?.();
  }
}

let restore: () => void;
let attachFaviconFallback: (img: HTMLImageElement) => void;

beforeAll(async () => {
  restore = installClientEnv();
  ({ attachFaviconFallback } = await import("../../src/client/utils/dom/favicon"));
});

afterAll(() => restore());

const attach = (img: FakeImage): void => attachFaviconFallback(img as unknown as HTMLImageElement);

describe("favicon resolution class", () => {
  test("an icon of 32px or more is marked hi-res", () => {
    const img = new FakeImage(true, 64);
    attach(img);
    expect(img.classes.has("favicon-hires")).toBe(true);
  });

  test("a small icon stays on the tile", () => {
    const img = new FakeImage(true, 18);
    attach(img);
    expect(img.classes.has("favicon-hires")).toBe(false);
  });

  test("an icon still loading is marked once it arrives", () => {
    const img = new FakeImage(false, 0);
    attach(img);
    expect(img.classes.has("favicon-hires")).toBe(false);
    img.finishLoading(120);
    expect(img.classes.has("favicon-hires")).toBe(true);
  });

  test("a refreshed icon that got smaller loses the class", () => {
    const img = new FakeImage(true, 64);
    attach(img);
    img.complete = false;
    attach(img);
    img.finishLoading(16);
    expect(img.classes.has("favicon-hires")).toBe(false);
  });
});
