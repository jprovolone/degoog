import { beforeAll, describe, expect, test } from "bun:test";
import { initServerKey, signData } from "../../../src/server/utils/security/server-key";
import {
  generateSearchNonce,
  verifySearchNonce,
} from "../../../src/server/utils/security/search-nonce";
import { mintToken, verifyToken } from "../../../src/server/utils/security/link-token";
import { buildSignedProxyUrl } from "../../../src/server/utils/net/proxy-sign";

const DAY_MS = 24 * 60 * 60 * 1000;
const RAND_HEX = "ab".repeat(16);

const nonceAt = (ms: number): string =>
  Math.floor(ms).toString(16).padStart(12, "0") + RAND_HEX;

beforeAll(async () => {
  await initServerKey();
});

describe("search nonce", () => {
  test("a freshly issued nonce verifies", () => {
    const { n, s } = generateSearchNonce();
    expect(verifySearchNonce(n, s)).toBe(true);
  });

  test("a nonce stamped in the future never verifies, even when correctly signed", () => {
    const n = nonceAt(Date.now() + 365 * DAY_MS);
    expect(verifySearchNonce(n, signData(`nonce:${n}`))).toBe(false);
  });

  test("an expired nonce does not verify", () => {
    const n = nonceAt(Date.now() - 2 * 60 * 60 * 1000);
    expect(verifySearchNonce(n, signData(`nonce:${n}`))).toBe(false);
  });

  test("an image proxy signature over a nonce-shaped string is not a nonce", () => {
    const n = nonceAt(Date.now());
    const sig = new URL(buildSignedProxyUrl(n), "http://x").searchParams.get("sig") ?? "";
    expect(verifySearchNonce(n, sig)).toBe(false);
  });
});

describe("link token", () => {
  test("a minted token verifies", () => {
    expect(verifyToken(mintToken())).toBe(true);
  });

  test("an image proxy signature over a timestamp is not a link token", () => {
    const ts = Date.now().toString(16).padStart(16, "0");
    expect(verifyToken(`${ts}${signData(ts).slice(0, 32)}`)).toBe(false);
  });
});
