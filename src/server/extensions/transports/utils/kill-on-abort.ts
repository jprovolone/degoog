interface Killable {
  kill: () => void;
}

export const killOnAbort = (
  proc: Killable,
  signal: AbortSignal | undefined,
): (() => void) => {
  if (!signal) return () => {};
  const onAbort = (): void => proc.kill();
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
};
