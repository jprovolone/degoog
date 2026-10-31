import { afterEach, describe, expect, test } from "bun:test";
import { FetchEventStream } from "../../../src/client/utils/search/streaming/fetch-event-stream";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const serve = (chunk: string): void => {
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
    )) as unknown as typeof fetch;
};

describe("FetchEventStream", () => {
  test("events already read stop once the stream is closed", async () => {
    serve("event: done\ndata: 1\n\nevent: result\ndata: 2\n\nevent: result\ndata: 3\n\n");
    const seen: string[] = [];
    const source = new FetchEventStream("http://localhost/stream");
    source.addEventListener("done", (e) => {
      seen.push(`done:${e.data}`);
      source.close();
    });
    source.addEventListener("result", (e) => seen.push(`result:${e.data}`));
    source.addEventListener("error", () => seen.push("error"));
    await Bun.sleep(20);
    expect(seen).toEqual(["done:1"]);
  });

  test("an open stream delivers every event, then reports the end", async () => {
    serve("event: result\ndata: 1\n\nevent: result\ndata: 2\n\n");
    const seen: string[] = [];
    const source = new FetchEventStream("http://localhost/stream");
    source.addEventListener("result", (e) => seen.push(`result:${e.data}`));
    source.addEventListener("error", () => seen.push("error"));
    await Bun.sleep(20);
    expect(seen).toEqual(["result:1", "result:2", "error"]);
  });
});
