import { blocklistFile } from "../paths";
import { logger } from "../logger";
import { readJsonOrQuarantine } from "../storage/read-json";
import { writeJsonAtomic } from "../storage/atomic-json";
import { createMutex } from "../cache/mutex";

type BlockEntry = { ip: string; time: string };

const HOURS_TO_MS = 3_600_000;

let _cache: BlockEntry[] | null = null;
const writeLock = createMutex();

const load = async (): Promise<BlockEntry[]> => {
  if (_cache !== null) return _cache;
  try {
    const parsed = await readJsonOrQuarantine<BlockEntry[]>(
      "blocklist",
      blocklistFile(),
    );
    _cache = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.debug("blocklist", "blocklist file read failed", err);
    _cache = [];
  }
  return _cache;
};

const persist = async (entries: BlockEntry[]): Promise<void> => {
  _cache = entries;
  try {
    await writeJsonAtomic(blocklistFile(), entries);
  } catch (e) {
    logger.error("blocklist", `failed to write: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const _mutate = (edit: (entries: BlockEntry[]) => BlockEntry[]): Promise<BlockEntry[]> =>
  writeLock(async () => {
    const next = edit(await load());
    await persist(next);
    return next;
  });

const isLive = (entry: BlockEntry, banHours: number): boolean => {
  if (banHours <= 0) return true;
  return Date.now() - new Date(entry.time).getTime() < banHours * HOURS_TO_MS;
};

const evict = async (banHours: number): Promise<BlockEntry[]> => {
  const entries = await load();
  if (entries.every((e) => isLive(e, banHours))) return entries;
  return _mutate((current) => current.filter((e) => isLive(e, banHours)));
};

export const checkBlocked = async (ip: string, banHours: number): Promise<boolean> => {
  const active = await evict(banHours);
  return active.some(e => e.ip === ip);
};

export const listActive = (banHours: number): Promise<BlockEntry[]> => evict(banHours);

export const addEntry = async (ip: string): Promise<void> => {
  await _mutate((entries) => [
    ...entries.filter((e) => e.ip !== ip),
    { ip, time: new Date().toISOString() },
  ]);
};

export const removeEntry = async (ip: string): Promise<void> => {
  await _mutate((entries) => entries.filter((e) => e.ip !== ip));
};

export const resetCache = (): void => {
  _cache = null;
};
