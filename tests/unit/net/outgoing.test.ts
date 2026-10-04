import { describe, test, expect } from "bun:test";
import {
  fetchWithinAllowlist,
  isUrlAllowedForOutgoing,
  parseAllowedHosts,
} from "../../../src/server/utils/net/outgoing";
import type {
  TransportContext,
  TransportFetchOptions,
} from "../../../src/server/types/extension";

type Hop = { url: string; options: TransportFetchOptions };

const fakeTransport = (routes: Record<string, Response | (() => Response)>) => {
  const hops: Hop[] = [];
  return {
    hops,
    fetch: async (url: string, options: TransportFetchOptions) => {
      hops.push({ url, options });
      const route = routes[url];
      if (!route) return new Response("missing", { status: 404 });
      return typeof route === "function" ? route() : route;
    },
  };
};

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { Location: location } });

const ctx = {} as TransportContext;

describe("outgoing", () => {
  describe("parseAllowedHosts", () => {
    test("unset or blank means no restriction", () => {
      expect(parseAllowedHosts(undefined)).toBeNull();
      expect(parseAllowedHosts(" , ")).toBeNull();
    });

    test("trims and lowercases entries", () => {
      expect(parseAllowedHosts(" Example.COM ,api.example.org")).toEqual([
        "example.com",
        "api.example.org",
      ]);
    });
  });

  describe("isUrlAllowedForOutgoing", () => {
    test("no allowlist allows everything", () => {
      expect(isUrlAllowedForOutgoing("https://any.com", null)).toBe(true);
    });

    test("non-http protocols are rejected with or without an allowlist", () => {
      for (const url of ["file:///etc/passwd", "gopher://any.com", "ftp://any.com"]) {
        expect(isUrlAllowedForOutgoing(url, null)).toBe(false);
        expect(isUrlAllowedForOutgoing(url, parseAllowedHosts("*"))).toBe(false);
      }
    });

    test("allows only listed hosts", () => {
      const allowed = parseAllowedHosts("example.com,api.example.org");
      expect(isUrlAllowedForOutgoing("https://example.com/path", allowed)).toBe(true);
      expect(isUrlAllowedForOutgoing("http://api.example.org", allowed)).toBe(true);
      expect(isUrlAllowedForOutgoing("https://other.com", allowed)).toBe(false);
      expect(isUrlAllowedForOutgoing("https://sub.example.com", allowed)).toBe(false);
    });

    test("host matching is case-insensitive", () => {
      const allowed = parseAllowedHosts("Example.COM");
      expect(isUrlAllowedForOutgoing("https://EXAMPLE.COM", allowed)).toBe(true);
    });

    test("*.example.com matches subdomains but not the apex or lookalikes", () => {
      const allowed = parseAllowedHosts("*.example.com");
      expect(isUrlAllowedForOutgoing("https://a.example.com", allowed)).toBe(true);
      expect(isUrlAllowedForOutgoing("https://a.b.example.com", allowed)).toBe(true);
      expect(isUrlAllowedForOutgoing("https://example.com", allowed)).toBe(false);
      expect(isUrlAllowedForOutgoing("https://badexample.com", allowed)).toBe(false);
    });

    test("* allows any host", () => {
      const allowed = parseAllowedHosts("*");
      expect(isUrlAllowedForOutgoing("https://any.com", allowed)).toBe(true);
    });

    test("unparseable urls are refused when an allowlist is set", () => {
      expect(isUrlAllowedForOutgoing("not-a-url", parseAllowedHosts("*"))).toBe(false);
    });
  });

  describe("fetchWithinAllowlist", () => {
    test("follows allowed redirects hop by hop in manual mode", async () => {
      const transport = fakeTransport({
        "https://a.example.com/start": redirect("/next"),
        "https://a.example.com/next": redirect("https://b.example.com/end", 301),
        "https://b.example.com/end": new Response("done"),
      });
      const res = await fetchWithinAllowlist(
        transport,
        "https://a.example.com/start",
        {},
        ctx,
        parseAllowedHosts("*.example.com"),
      );
      expect(await res.text()).toBe("done");
      expect(transport.hops.map((h) => h.url)).toEqual([
        "https://a.example.com/start",
        "https://a.example.com/next",
        "https://b.example.com/end",
      ]);
      expect(transport.hops.every((h) => h.options.redirect === "manual")).toBe(true);
    });

    test("refuses a redirect to a host outside the allowlist", async () => {
      const transport = fakeTransport({
        "https://allowed.example/start": redirect("https://disallowed.example/"),
      });
      await expect(
        fetchWithinAllowlist(
          transport,
          "https://allowed.example/start",
          {},
          ctx,
          parseAllowedHosts("allowed.example"),
        ),
      ).rejects.toThrow("Outgoing host not allowed: disallowed.example");
      expect(transport.hops.map((h) => h.url)).toEqual(["https://allowed.example/start"]);
    });

    test("refuses a redirect to a non-http protocol", async () => {
      const transport = fakeTransport({
        "https://allowed.example/start": redirect("file:///etc/passwd"),
      });
      await expect(
        fetchWithinAllowlist(
          transport,
          "https://allowed.example/start",
          {},
          ctx,
          parseAllowedHosts("*"),
        ),
      ).rejects.toThrow("Outgoing host not allowed");
    });

    test("303 switches to GET and cross-origin hops drop credentials", async () => {
      const transport = fakeTransport({
        "https://a.example.com/form": redirect("https://b.example.com/done", 303),
        "https://b.example.com/done": new Response("ok"),
      });
      await fetchWithinAllowlist(
        transport,
        "https://a.example.com/form",
        {
          method: "POST",
          body: "x=1",
          headers: { Authorization: "Bearer t", Cookie: "a=1", Accept: "text/html" },
        },
        ctx,
        parseAllowedHosts("*.example.com"),
      );
      const last = transport.hops[1].options;
      expect(last.method).toBe("GET");
      expect(last.body).toBeUndefined();
      expect(last.headers).toEqual({ Accept: "text/html" });
    });

    test("gives up after too many redirects", async () => {
      const transport = fakeTransport({
        "https://loop.example/": () => redirect("https://loop.example/"),
      });
      await expect(
        fetchWithinAllowlist(
          transport,
          "https://loop.example/",
          {},
          ctx,
          parseAllowedHosts("loop.example"),
        ),
      ).rejects.toThrow("Too many redirects");
    });
  });
});
