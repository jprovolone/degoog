import { describe, expect, test } from "bun:test";
import { buildThemedLayoutPage } from "../../../src/server/routes/pages/render";
import {
  beforeHeadEnd,
  subFirst,
} from "../../../src/server/render/substitute";
import { windowGlobalScript } from "../../../src/server/render/window-global-script";

const DOLLAR_PATTERNS = "price $& then $$ and $' plus $` end";

describe("page placeholder substitution", () => {
  test("a themed page containing replacement patterns survives intact", async () => {
    const html = await buildThemedLayoutPage(`<p id="probe">${DOLLAR_PATTERNS}</p>`);
    expect(html).toContain(`<p id="probe">${DOLLAR_PATTERNS}</p>`);
    expect(html).not.toContain("__PAGE_CONTENT__");
  });

  test("placeholder and head helpers insert values verbatim", () => {
    expect(subFirst("<b>__X__</b>", "__X__", DOLLAR_PATTERNS)).toBe(`<b>${DOLLAR_PATTERNS}</b>`);
    expect(beforeHeadEnd("<head></head>", DOLLAR_PATTERNS)).toBe(
      `<head>${DOLLAR_PATTERNS}\n  </head>`,
    );
  });

  test("window globals cannot close their own script tag", () => {
    const script = windowGlobalScript("__PROBE__", { value: "</script><b>$&</b>" });
    expect(script).toBe(
      '<script>window.__PROBE__={"value":"\\u003c/script>\\u003cb>$&\\u003c/b>"}</script>',
    );
  });

  test("window globals cannot enter the double-escaped script state", () => {
    const script = windowGlobalScript("__PROBE__", { value: "<!--<script>" });
    expect(script).toBe(
      '<script>window.__PROBE__={"value":"\\u003c!--\\u003cscript>"}</script>',
    );
  });
});
