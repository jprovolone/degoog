import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  fetchPastAnubis,
  hasAnubisChallenge,
  readAnubisChallenge,
  solveAnubis,
  type AnubisSend,
} from "../../../src/server/utils/net/challenges/anubis";
import type { TransportFetchOptions } from "../../../src/server/types/extension";

const ORIGIN = "https://search.example";
const SEARCH_URL = `${ORIGIN}/sp/search?query=test`;
const PASS_PREFIX = `${ORIGIN}/.within.website/x/cmd/anubis/api/pass-challenge`;

const challengePage = (difficulty: number, prefix = ""): string =>
  `<html><head><script id="anubis_version" type="application/json">"v1.26.4"</script>` +
  `<script id="anubis_challenge" type="application/json">${JSON.stringify({
    rules: { algorithm: "fast", difficulty },
    challenge: { id: "challenge-1", randomData: "abc123", issuedAt: "2026-09-30T15:14:21Z" },
  })}</script>` +
  `<script id="anubis_base_prefix" type="application/json">${JSON.stringify(prefix)}</script>` +
  `</head><body>Making sure you're not a bot!</body></html>`;

const html = (body: string, cookies: string[] = [], status = 200): Response => {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(body, { status, headers });
};

const cookiesOf = (init: TransportFetchOptions): string => init.headers?.Cookie ?? "";

interface Recorded {
  url: string;
  init: TransportFetchOptions;
}

const gatedSite = (difficulty = 2) => {
  const calls: Recorded[] = [];
  const send: AnubisSend = async (url, init) => {
    calls.push({ url, init });
    const cookie = cookiesOf(init);
    if (url.startsWith(PASS_PREFIX)) {
      if (!cookie.includes("sp_pow=pow-1") || !cookie.includes("spchal-cookie-verification=verify-1")) {
        return html("error", ["spchal-auth=; Path=/"], 500);
      }
      return new Response(null, {
        status: 302,
        headers: { Location: SEARCH_URL, "Set-Cookie": "spchal-auth=token-1; Path=/; HttpOnly" },
      });
    }
    if (cookie.includes("spchal-auth=token-1")) return html("<div>results</div>");
    return html(challengePage(difficulty), [
      "spchal-cookie-verification=verify-1; Path=/; Expires=Wed, 30 Sep 2026 16:00:03 GMT; Secure",
      "sp_pow=pow-1; Max-Age=300; HttpOnly; Path=/",
    ]);
  };
  return { calls, send };
};

describe("anubis challenge parsing", () => {
  test("reads the challenge id, data, difficulty and base prefix", () => {
    const page = challengePage(4, "/gate/");
    expect(hasAnubisChallenge(page)).toBe(true);
    expect(readAnubisChallenge(page)).toEqual({
      id: "challenge-1",
      data: "abc123",
      difficulty: 4,
      basePrefix: "/gate",
    });
  });

  test("ignores ordinary pages and broken challenge scripts", () => {
    expect(hasAnubisChallenge("<div>results</div>")).toBe(false);
    expect(readAnubisChallenge('<script id="anubis_challenge">{nope</script>')).toBeNull();
  });
});

describe("anubis solver", () => {
  test("finds a nonce whose hash has the required leading zero nibbles", async () => {
    const solved = await solveAnubis({ id: "x", data: "abc123", difficulty: 3, basePrefix: "" });
    expect(solved).not.toBeNull();
    const digest = createHash("sha256").update(`abc123${solved!.nonce}`).digest("hex");
    expect(digest).toBe(solved!.response);
    expect(digest.startsWith("000")).toBe(true);
  });

  test("gives up once the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const solved = await solveAnubis(
      { id: "x", data: "abc123", difficulty: 12, basePrefix: "" },
      { signal: controller.signal },
    );
    expect(solved).toBeNull();
  });
});

describe("fetchPastAnubis", () => {
  test("passes an ungated page through untouched", async () => {
    const send: AnubisSend = async () => html("<div>plain</div>");
    const res = await fetchPastAnubis(send, SEARCH_URL, {}, { jarKey: "plain" });
    expect(await res.text()).toBe("<div>plain</div>");
  });

  test("solves the gate, sends the challenge cookies with the pass and retries", async () => {
    const { calls, send } = gatedSite();
    const res = await fetchPastAnubis(
      send,
      SEARCH_URL,
      { headers: { Cookie: "preferences=dark" } },
      { jarKey: "solve" },
    );
    expect(await res.text()).toBe("<div>results</div>");
    expect(calls).toHaveLength(3);
    const pass = calls[1];
    expect(pass.url.startsWith(PASS_PREFIX)).toBe(true);
    expect(pass.init.redirect).toBe("manual");
    expect(pass.init.headers?.Referer).toBe(SEARCH_URL);
    expect(cookiesOf(pass.init)).toContain("sp_pow=pow-1");
    expect(cookiesOf(calls[2].init)).toContain("preferences=dark");
    expect(cookiesOf(calls[2].init)).toContain("spchal-auth=token-1");
  });

  test("reuses the saved token without solving again", async () => {
    const { calls, send } = gatedSite();
    await fetchPastAnubis(send, SEARCH_URL, {}, { jarKey: "reuse" });
    calls.length = 0;
    const res = await fetchPastAnubis(send, SEARCH_URL, {}, { jarKey: "reuse" });
    expect(await res.text()).toBe("<div>results</div>");
    expect(calls).toHaveLength(1);
  });

  test("refuses a challenge above the difficulty limit", async () => {
    const { send } = gatedSite(5);
    await expect(
      fetchPastAnubis(send, SEARCH_URL, {}, { jarKey: "hard", engine: "Startpage", maxDifficulty: 4 }),
    ).rejects.toMatchObject({ status: "interstitial", engine: "Startpage" });
  });

  test("reports a transport that drops cookies instead of looping", async () => {
    const send: AnubisSend = async (url) =>
      url.startsWith(PASS_PREFIX) ? new Response(null, { status: 302 }) : html(challengePage(1));
    await expect(fetchPastAnubis(send, SEARCH_URL, {}, { jarKey: "cookieless" })).rejects.toThrow(
      /dropping its cookies/,
    );
  });
});
