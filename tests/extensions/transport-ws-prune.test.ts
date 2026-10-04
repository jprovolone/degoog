import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initTransports } from "../../src/server/extensions/transports/registry";
import { getTransportWsHandlers } from "../../src/server/extensions/transports/ws-registry";

const root = mkdtempSync(join(tmpdir(), "degoog-ws-prune-"));
const prevDir = process.env.DEGOOG_TRANSPORTS_DIR;
process.env.DEGOOG_TRANSPORTS_DIR = root;

const FOLDER = "socket-bridge";
const NAME = "socket-bridge-transport";

const writeTransport = (): void => {
  const dir = join(root, FOLDER);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.js"),
    `export default {
  name: "socket-bridge",
  available: () => true,
  fetch: () => new Response("ok"),
  wsHandler: { onOpen() {}, onMessage() {}, onClose() {} },
};
`,
  );
};

afterAll(() => {
  if (prevDir === undefined) delete process.env.DEGOOG_TRANSPORTS_DIR;
  else process.env.DEGOOG_TRANSPORTS_DIR = prevDir;
  rmSync(root, { recursive: true, force: true });
});

describe("transport websocket handlers", () => {
  test("a reload drops the handlers of a removed transport", async () => {
    writeTransport();
    await initTransports(true);
    expect(getTransportWsHandlers().has(NAME)).toBe(true);

    rmSync(join(root, FOLDER), { recursive: true, force: true });
    await initTransports(true);
    expect(getTransportWsHandlers().has(NAME)).toBe(false);
  });

  test("a reload keeps the handlers of a still installed transport", async () => {
    writeTransport();
    await initTransports(true);
    await initTransports(true);
    expect(getTransportWsHandlers().has(NAME)).toBe(true);
  });
});
