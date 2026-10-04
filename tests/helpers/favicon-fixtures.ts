export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
export const ICO_BYTES = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);
export const GIF_BYTES = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000");
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
export const WEBP_BYTES = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
export const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
export const HTML_BYTES = new TextEncoder().encode("<!doctype html><html></html>");
