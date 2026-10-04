import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

const SEARCH_UTILS_MOD = "../../src/server/utils/search";
const searchUtilsReal = { ...(await import(SEARCH_UTILS_MOD)) };

const limited: string[] = [];
let app: Hono;

beforeAll(async () => {
  mock.module(SEARCH_UTILS_MOD, () => ({
    ...searchUtilsReal,
    _applyRateLimit: async (c: { req: { path: string } }) => {
      limited.push(c.req.path);
      return null;
    },
  }));
  const teapot = (await import("../../src/server/routes/easter-eggs/teapot")).default;
  const later = new Hono();
  later.get("/api/proxy/image", (c) => c.text("img"));
  later.post("/api/settings/auth", (c) => c.text("auth"));
  app = new Hono();
  app.route("/", teapot);
  app.route("/", later);
});

afterAll(() => {
  mock.module(SEARCH_UTILS_MOD, () => searchUtilsReal);
});

describe("teapot rate limit scope", () => {
  test("only the teapot's own routes are rate limited by it", async () => {
    await app.request("/teapot");
    await app.request("/teapot/green", { method: "POST" });
    await app.request("/api/proxy/image");
    await app.request("/api/settings/auth", { method: "POST" });
    expect(limited).toEqual(["/teapot", "/teapot/green"]);
  });
});
