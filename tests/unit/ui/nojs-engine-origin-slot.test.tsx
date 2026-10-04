import { describe, expect, test } from "bun:test";
import { renderHtml } from "../../../src/shared/ui/tribute/html";
import { EngineOriginSlot } from "../../../src/server/nojs/sidebar/engine-origin-slot";
import {
  EngineOriginDisplay,
  EngineOriginKind,
  type EngineOrigin,
} from "../../../src/shared/engine-origins";

const origin = (favicon: string | undefined): EngineOrigin => ({
  kind: EngineOriginKind.Core,
  label: "Degoog",
  icon: "/public/core.png",
  ...(favicon === undefined ? {} : { favicon }),
});

const html = (o: EngineOrigin, mode: EngineOriginDisplay): string => {
  const node = EngineOriginSlot({ origin: o, mode, engineName: "e", label: "E" });
  return node ? renderHtml(node) : "";
};

describe("nojs engine origin slot", () => {
  test("an empty favicon hides the slot in favicon mode", () => {
    expect(html(origin(""), EngineOriginDisplay.Favicon)).toBe("");
  });

  test("a signed favicon is used in favicon mode", () => {
    expect(html(origin("/api/proxy/favicon?domain=e.test&sig=ab"), EngineOriginDisplay.Favicon)).toContain(
      "/api/proxy/favicon?domain=e.test&amp;sig=ab",
    );
  });

  test("provenance mode still shows the provenance icon", () => {
    expect(html(origin(""), EngineOriginDisplay.Provenance)).toContain("/public/core.png");
  });

  test("an engine with no known host falls back to its provenance icon", () => {
    expect(html(origin(undefined), EngineOriginDisplay.Favicon)).toContain("/public/core.png");
  });
});
