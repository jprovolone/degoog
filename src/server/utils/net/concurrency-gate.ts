export type ReleaseGate = () => void;

export interface ConcurrencyGate {
  acquire: () => Promise<ReleaseGate | null>;
  stats: () => { active: number; queued: number };
}

export const createConcurrencyGate = (
  maxActive: number,
  maxQueued: number,
): ConcurrencyGate => {
  let active = 0;
  const waiting: (() => void)[] = [];

  const _release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  const _once = (): ReleaseGate => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      _release();
    };
  };

  return {
    acquire: async () => {
      if (active < maxActive) {
        active++;
        return _once();
      }
      if (waiting.length >= maxQueued) return null;
      await new Promise<void>((resolve) => waiting.push(resolve));
      return _once();
    },
    stats: () => ({ active, queued: waiting.length }),
  };
};
