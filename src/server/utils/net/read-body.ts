import { withTimeout } from "./with-timeout";

export const readWithin = <T>(read: Promise<T>, idleMs: number): Promise<T> =>
  withTimeout(read, idleMs, "upstream body");

export const readBodyCapped = async (
  res: Response,
  cap: number,
  idleMs: number,
): Promise<ArrayBuffer | "too-large" | "empty"> => {
  const reader = res.body?.getReader();
  if (!reader) return "empty";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readWithin(reader.read(), idleMs).catch(
        async (err: unknown) => {
          await reader.cancel().catch(() => {});
          throw err;
        },
      );
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return "too-large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const out = new ArrayBuffer(total);
  const view = new Uint8Array(out);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};
