import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFile, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const hostsFile = join(tmpdir(), `degoog-engine-hosts-${Date.now()}.json`);
const _originalHostsFile = process.env.DEGOOG_ENGINE_HOSTS_FILE;
process.env.DEGOOG_ENGINE_HOSTS_FILE = hostsFile;

const { engineHost, flushHosts, noteEngineHost, primeEngineHosts } = await import(
  "../../src/server/extensions/engines/engine-hosts"
);

const { drainServer } = await import("../../src/server/utils/server-lifecycle");

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterAll(async () => {
  if (_originalHostsFile === undefined) delete process.env.DEGOOG_ENGINE_HOSTS_FILE;
  else process.env.DEGOOG_ENGINE_HOSTS_FILE = _originalHostsFile;
  await unlink(hostsFile).catch(() => {});
});

describe("engine hosts", () => {
  beforeEach(async () => {
    await writeFile(hostsFile, "{}", "utf-8");
    await primeEngineHosts();
  });

  test("remembers the host an engine first reaches for", async () => {
    noteEngineHost("google-engine", "https://www.google.com/search?q=cats");
    await settle();
    expect(engineHost("google-engine")).toBe("www.google.com");
  });

  test("keeps the first host and ignores later ones", async () => {
    noteEngineHost("google-videos-engine", "https://www.google.com/search?q=cats");
    await settle();
    noteEngineHost("google-videos-engine", "https://i.ytimg.com/vi/abc/hq.jpg");
    await settle();
    expect(engineHost("google-videos-engine")).toBe("www.google.com");
  });

  test("ignores junk urls and engines with no id", async () => {
    noteEngineHost("broken-engine", "not a url");
    noteEngineHost(undefined, "https://example.com");
    await settle();
    expect(engineHost("broken-engine")).toBeUndefined();
  });

  test("remembers local hosts and private addresses", async () => {
    noteEngineHost("localhost-engine", "http://localhost:8080/search");
    noteEngineHost("lan-engine", "http://192.168.86.233:8181/search");
    await settle();
    expect(engineHost("localhost-engine")).toBe("localhost");
    expect(engineHost("lan-engine")).toBe("192.168.86.233");
  });

  test("hosts written to disk survive a restart", async () => {
    await writeFile(
      hostsFile,
      JSON.stringify({ "brave-engine": "search.brave.com", "junk-engine": 42 }),
      "utf-8",
    );
    await primeEngineHosts();
    expect(engineHost("brave-engine")).toBe("search.brave.com");
    expect(engineHost("junk-engine")).toBeUndefined();
  });

  test("the file on disk is valid json", async () => {
    noteEngineHost("mojeek-engine", "https://www.mojeek.com/search?q=cats");
    await settle();
    await flushHosts();
    const onDisk = JSON.parse(await readFile(hostsFile, "utf-8"));
    expect(onDisk["mojeek-engine"]).toBe("www.mojeek.com");
  });

  test("shutting down writes a host that was still waiting for its debounce", async () => {
    noteEngineHost("qwant-engine", "https://www.qwant.com/?q=cats");
    await settle();
    await drainServer();
    const onDisk = JSON.parse(await readFile(hostsFile, "utf-8"));
    expect(onDisk["qwant-engine"]).toBe("www.qwant.com");
  });
});
