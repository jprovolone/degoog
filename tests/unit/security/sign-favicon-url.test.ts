import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { initServerKey } from "../../../src/server/utils/security/server-key";
import { signFaviconUrl, verifyFaviconSig } from "../../../src/server/utils/net/proxy-sign";
import { fakeFaviconProviders, restoreFaviconProviders } from "../../helpers/favicon-providers";
import { isolateFaviconEnv, type IsolatedEnv } from "../../helpers/favicon-env";

let env: IsolatedEnv;

beforeAll(async () => {
  env = isolateFaviconEnv("degoog-sign-favicon-");
  await initServerKey();
});

afterAll(() => {
  restoreFaviconProviders();
  env.restore();
});

describe("signFaviconUrl", () => {
  test("a result url becomes a signed same-origin favicon proxy url", () => {
    fakeFaviconProviders(true);
    const signed = signFaviconUrl("https://www.example.org/some/page?q=1");
    expect(signed).toStartWith("/api/proxy/favicon?domain=www.example.org&sig=");
    const sig = new URL(`http://x${signed}`).searchParams.get("sig") ?? "";
    expect(verifyFaviconSig("www.example.org", sig)).toBe(true);
    expect(verifyFaviconSig("evil.example", sig)).toBe(false);
  });

  test("junk urls never become a favicon url", () => {
    fakeFaviconProviders(true);
    expect(signFaviconUrl("not a url")).toBe("");
    expect(signFaviconUrl("")).toBe("");
  });

  test("nothing is signed while no favicon source is available", () => {
    fakeFaviconProviders(false);
    expect(signFaviconUrl("https://example.org/")).toBe("");
  });
});
