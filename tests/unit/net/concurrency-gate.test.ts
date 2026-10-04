import { describe, expect, test } from "bun:test";
import { createConcurrencyGate } from "../../../src/server/utils/net/concurrency-gate";

describe("concurrency gate", () => {
  test("lets requests through up to the cap and queues the rest instead of refusing them", async () => {
    const gate = createConcurrencyGate(2, 10);
    const a = await gate.acquire();
    const b = await gate.acquire();
    let thirdIn = false;
    const third = gate.acquire().then((r) => {
      thirdIn = true;
      return r;
    });
    await Promise.resolve();
    expect(thirdIn).toBe(false);
    expect(gate.stats()).toEqual({ active: 2, queued: 1 });
    a?.();
    const c = await third;
    expect(thirdIn).toBe(true);
    expect(gate.stats()).toEqual({ active: 2, queued: 0 });
    b?.();
    c?.();
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
  });

  test("refuses only once the queue itself is full", async () => {
    const gate = createConcurrencyGate(1, 1);
    await gate.acquire();
    void gate.acquire();
    expect(await gate.acquire()).toBeNull();
  });

  test("releasing twice frees only one slot", async () => {
    const gate = createConcurrencyGate(1, 5);
    const release = await gate.acquire();
    release?.();
    release?.();
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
    await gate.acquire();
    expect(gate.stats().active).toBe(1);
  });
});
