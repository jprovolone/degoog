import { describe, expect, test } from "bun:test";
import { streamBodyCapped } from "../../src/server/routes/proxy";

const chunks = (...parts: number[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of parts) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });

const drain = async (stream: ReadableStream<Uint8Array>): Promise<number> => {
  let total = 0;
  for await (const part of stream) total += part.byteLength;
  return total;
};

describe("image proxy streaming", () => {
  test("passes the whole image through and frees its slot once", async () => {
    let released = 0;
    const out = streamBodyCapped(chunks(10, 20, 30), 100, 1000, Date.now() + 5000, () => released++);
    expect(await drain(out)).toBe(60);
    expect(released).toBe(1);
  });

  test("stops an image that grows past the cap without buffering it", async () => {
    let released = 0;
    const out = streamBodyCapped(chunks(60, 60), 100, 1000, Date.now() + 5000, () => released++);
    await expect(drain(out)).rejects.toThrow("image too large");
    expect(released).toBe(1);
  });

  test("gives up on an upstream that drips past the overall deadline", async () => {
    let released = 0;
    const drip = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await Bun.sleep(30);
        controller.enqueue(new Uint8Array(1));
      },
    });
    const out = streamBodyCapped(drip, 1_000_000, 1000, Date.now() + 100, () => released++);
    await expect(drain(out)).rejects.toThrow();
    expect(released).toBe(1);
  });

  test("a visitor closing the page frees the slot", async () => {
    let released = 0;
    const out = streamBodyCapped(chunks(10, 10), 100, 1000, Date.now() + 5000, () => released++);
    await out.cancel();
    expect(released).toBe(1);
  });
});
