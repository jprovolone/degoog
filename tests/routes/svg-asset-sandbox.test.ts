import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "degoog-svg-sandbox-"));
const themesDir = join(root, "themes");
const saved = {
  themes: process.env.DEGOOG_THEMES_DIR,
  data: process.env.DEGOOG_DATA_DIR,
  noPassword: process.env.DEGOOG_DANGEROUSLY_NO_PASSWORD,
  passwords: process.env.DEGOOG_SETTINGS_PASSWORDS,
};

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

type Router = { request: (req: Request) => Response | Promise<Response> };
let router: Router;
let store: Router;
let SVG_CSP: string;

beforeAll(async () => {
  process.env.DEGOOG_THEMES_DIR = themesDir;
  mkdirSync(join(themesDir, "evil"), { recursive: true });
  writeFileSync(
    join(themesDir, "evil", "logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  writeFileSync(join(themesDir, "evil", "logo.png"), "png");
  process.env.DEGOOG_DATA_DIR = root;
  process.env.DEGOOG_DANGEROUSLY_NO_PASSWORD = "true";
  delete process.env.DEGOOG_SETTINGS_PASSWORDS;
  mkdirSync(join(root, "store", "community-repo"), { recursive: true });
  writeFileSync(
    join(root, "store", "community-repo", "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  writeFileSync(join(root, "store", "community-repo", "icon.png"), "png");
  const freshAssets = "../../src/server/routes/extensions/plugin-assets.ts?svg-sandbox";
  router = ((await import(freshAssets)) as { default: Router }).default;
  store = (await import("../../src/server/routes/extensions/store")).default as Router;
  ({ SVG_CSP } = await import("../../src/server/utils/security/content-policy"));
});

afterAll(() => {
  restore("DEGOOG_THEMES_DIR", saved.themes);
  restore("DEGOOG_DATA_DIR", saved.data);
  restore("DEGOOG_DANGEROUSLY_NO_PASSWORD", saved.noPassword);
  restore("DEGOOG_SETTINGS_PASSWORDS", saved.passwords);
  rmSync(root, { recursive: true, force: true });
});

describe("extension SVG assets", () => {
  test("are served sandboxed with scripts off", async () => {
    const res = await router.request(new Request("http://localhost/themes/evil/logo.svg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe(SVG_CSP);
    expect(SVG_CSP).toContain("sandbox");
    expect(SVG_CSP).toContain("script-src 'none'");
    expect(SVG_CSP).not.toContain("default-src");
  });

  test("other image types are left to the global policy", async () => {
    const res = await router.request(new Request("http://localhost/themes/evil/logo.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  test("store previews from community repos are sandboxed too", async () => {
    const svg = await store.request(
      new Request("http://localhost/api/store/repos/community-repo/asset?path=icon.svg"),
    );
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-security-policy")).toBe(SVG_CSP);

    const png = await store.request(
      new Request("http://localhost/api/store/repos/community-repo/asset?path=icon.png"),
    );
    expect(png.status).toBe(200);
    expect(png.headers.get("content-security-policy")).toBeNull();
  });
});
