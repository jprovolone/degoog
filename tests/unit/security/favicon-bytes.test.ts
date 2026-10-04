import { describe, expect, test } from "bun:test";
import { FAVICON_MAX_BYTES, sniffFaviconType, validateFavicon } from "../../../src/server/utils/security/favicon-bytes";
import {
  GIF_BYTES,
  HTML_BYTES,
  ICO_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
  SVG_BYTES,
  WEBP_BYTES,
} from "../../helpers/favicon-fixtures";

describe("favicon byte validation", () => {
  test("png and ico are accepted with the type their bytes say", () => {
    expect(validateFavicon(PNG_BYTES)?.contentType).toBe("image/png");
    expect(validateFavicon(ICO_BYTES)?.contentType).toBe("image/x-icon");
  });

  test("gif, jpeg and webp are recognised by magic bytes", () => {
    expect(sniffFaviconType(GIF_BYTES)).toBe("image/gif");
    expect(sniffFaviconType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffFaviconType(WEBP_BYTES)).toBe("image/webp");
  });

  test("svg and html are refused whatever anyone claims they are", () => {
    expect(validateFavicon(SVG_BYTES)).toBeNull();
    expect(validateFavicon(HTML_BYTES)).toBeNull();
  });

  test("a riff container that is not webp is refused", () => {
    expect(validateFavicon(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBeNull();
  });

  test("empty and oversized payloads are refused", () => {
    expect(validateFavicon(new Uint8Array())).toBeNull();
    const huge = new Uint8Array(FAVICON_MAX_BYTES + 1);
    huge.set(PNG_BYTES);
    expect(validateFavicon(huge)).toBeNull();
    const edge = new Uint8Array(FAVICON_MAX_BYTES);
    edge.set(PNG_BYTES);
    expect(validateFavicon(edge)?.contentType).toBe("image/png");
  });
});
