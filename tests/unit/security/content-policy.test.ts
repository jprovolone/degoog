import { describe, expect, test } from "bun:test";
import {
  contentPolicyHeaders,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  LEAK_GUARD_POLICY,
  leakBufferScript,
} from "../../../src/server/utils/security/content-policy";

describe("content policy headers", () => {
  test("pages only report would-be leaks by default and never block them", () => {
    const headers = contentPolicyHeaders({ nojs: false, html: true, blockLeaks: false });
    expect(headers[CSP_REPORT_ONLY_HEADER]).toBe(LEAK_GUARD_POLICY);
    expect(headers[CSP_HEADER]).not.toContain("img-src");
  });

  test("blocking enforces the exact policy that reporting uses", () => {
    const headers = contentPolicyHeaders({ nojs: false, html: true, blockLeaks: true });
    expect(headers[CSP_HEADER]).toContain(LEAK_GUARD_POLICY);
    expect(headers[CSP_REPORT_ONLY_HEADER]).toBeUndefined();
  });

  test("the policy only allows this origin for every loadable resource", () => {
    for (const directive of ["img-src", "media-src", "font-src", "connect-src", "frame-src", "script-src", "style-src"]) {
      const rule = LEAK_GUARD_POLICY.split("; ").find((r) => r.startsWith(`${directive} `)) ?? "";
      expect(rule).toContain("'self'");
      expect(rule).not.toMatch(/https?:|\*/);
    }
  });

  test("non-html responses keep the baseline policy only", () => {
    const headers = contentPolicyHeaders({ nojs: false, html: false, blockLeaks: true });
    expect(Object.keys(headers)).toEqual([CSP_HEADER]);
    expect(headers[CSP_HEADER]).not.toContain("img-src");
  });

  test("nojs pages drop remote images when blocking is on", () => {
    expect(contentPolicyHeaders({ nojs: true, html: true, blockLeaks: false })[CSP_HEADER]).toContain("img-src 'self' data: https:");
    expect(contentPolicyHeaders({ nojs: true, html: true, blockLeaks: true })[CSP_HEADER]).toContain("img-src 'self' data:;");
  });
});

describe("early leak script", () => {
  type FakeWindow = {
    __DEGOOG_LEAKS__?: { url: string; directive: string; disposition: string }[];
    RTCPeerConnection?: new (config?: unknown) => object;
  };

  const run = (block: boolean, cookie = ""): FakeWindow => {
    class FakePeer {}
    const win: FakeWindow = { RTCPeerConnection: FakePeer };
    const source = leakBufferScript(block).replace(/^<script>|<\/script>$/g, "");
    new Function("window", "document", "DOMException", source)(
      win,
      { addEventListener: () => {}, cookie },
      class extends Error {},
    );
    return win;
  };

  const config = { iceServers: [{ urls: "stun:stun.example.org:3478" }] };

  test("blocking refuses WebRTC and records what it was going to contact", () => {
    const win = run(true);
    expect(() => new win.RTCPeerConnection!(config)).toThrow();
    expect(win.__DEGOOG_LEAKS__).toEqual([
      { url: "stun:stun.example.org:3478", directive: "webrtc", disposition: "enforce" },
    ]);
  });

  test("without blocking WebRTC still works and is only reported", () => {
    const win = run(false);
    expect(new win.RTCPeerConnection!(config)).toBeDefined();
    expect(win.__DEGOOG_LEAKS__?.[0]?.disposition).toBe("report");
  });

  test("a visitor who chose continue anyway gets WebRTC back", () => {
    const win = run(true, "degoog-leaks-allowed=1");
    expect(new win.RTCPeerConnection!(config)).toBeDefined();
    expect(win.__DEGOOG_LEAKS__?.[0]?.disposition).toBe("report");
  });
});
