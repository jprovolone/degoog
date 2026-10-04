import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";
import { fetchOverSocket } from "../../../src/server/utils/net/raw-http";

const servers: net.Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const silentServer = async (): Promise<number> => {
  const server = net.createServer(() => {});
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
};

const connect = (port: number): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });

const abortSoon = (): AbortSignal => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  return ac.signal;
};

describe("raw-http abort", () => {
  test("an abort during a stuck TLS handshake rejects and destroys the raw socket", async () => {
    const port = await silentServer();
    let raw: net.Socket | null = null;

    await expect(
      fetchOverSocket("https://example.test/", { signal: abortSoon() }, async () => {
        raw = await connect(port);
        return raw;
      }),
    ).rejects.toThrow();

    expect(raw!.destroyed).toBe(true);
  });

  test("an abort while the socket is still opening rejects and destroys the late socket", async () => {
    const port = await silentServer();
    let late: net.Socket | null = null;
    let opened: () => void = () => {};
    const openedLate = new Promise<void>((resolve) => {
      opened = resolve;
    });

    await expect(
      fetchOverSocket("http://example.test/", { signal: abortSoon() }, async () => {
        await Bun.sleep(150);
        late = await connect(port);
        opened();
        return late;
      }),
    ).rejects.toThrow();

    await openedLate;
    await Bun.sleep(0);
    expect(late!.destroyed).toBe(true);
  });

  test("an already aborted signal never opens a socket", async () => {
    const ac = new AbortController();
    ac.abort();
    let opened = false;

    await expect(
      fetchOverSocket("http://example.test/", { signal: ac.signal }, async () => {
        opened = true;
        return connect(await silentServer());
      }),
    ).rejects.toThrow();

    expect(opened).toBe(false);
  });
});
