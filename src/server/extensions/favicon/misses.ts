import { useCache } from "../../utils/cache/cache";

const MISS_NAMESPACE = "favicon-miss";
const MISS_TTL_MS = 60 * 60 * 1000;

const _misses = useCache<true>(MISS_NAMESPACE, MISS_TTL_MS);

export const isFaviconMiss = async (key: string): Promise<boolean> =>
  (await _misses.get(key)) === true;

export const noteFaviconMiss = (key: string): Promise<void> => _misses.set(key, true);

export const forgetFaviconMiss = (key: string): Promise<void> => _misses.delete(key);

export const forgetFaviconMisses = (): Promise<void> => _misses.clear();
