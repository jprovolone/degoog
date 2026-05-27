import { idbGet } from "./db";
import { SETTINGS_KEY } from "../constants";
import { getBase } from "./base-url";
import type { EngineRecord, EngineRegistry } from "../types";

const BUILTIN_SEARCH_TYPES = ["web", "images", "videos", "news"] as const;

let cachedRegistry: EngineRegistry | null = null;
let inflightRegistry: Promise<EngineRegistry> | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("extensions-saved", () => {
    cachedRegistry = null;
    inflightRegistry = null;
  });
}

export const getRegistry = async (): Promise<EngineRegistry> => {
  if (cachedRegistry) return cachedRegistry;
  if (!inflightRegistry) {
    inflightRegistry = fetch(`${getBase()}/api/engines`)
      .then((res) => res.json() as Promise<EngineRegistry>)
      .then((data) => {
        cachedRegistry = data;
        inflightRegistry = null;
        return data;
      });
  }
  return inflightRegistry;
};

export const getEngines = async (): Promise<EngineRecord> => {
  const saved = (await idbGet<EngineRecord>(SETTINGS_KEY)) ?? {};
  const reg = await getRegistry();
  const merged: EngineRecord = {};
  for (const { id } of reg.engines) {
    merged[id] = saved[id] ?? reg.defaults?.[id] ?? true;
  }
  return merged;
};

const _typesForEngine = (engine: {
  searchTypes?: string[];
  primaryType?: string;
}): string[] => {
  if (engine.searchTypes?.length) return engine.searchTypes;
  if (engine.primaryType) return [engine.primaryType];
  return ["web"];
};

export const getEnabledSearchTypes = async (): Promise<Set<string>> => {
  const engines = await getEngines();
  const reg = await getRegistry();
  const types = new Set<string>();
  for (const engine of reg.engines) {
    if (!engines[engine.id]) continue;
    for (const t of _typesForEngine(engine)) {
      types.add(t);
    }
  }
  return types;
};

export const getKnownSearchTypePrefixes = async (): Promise<Set<string>> => {
  const enabled = await getEnabledSearchTypes();
  const prefixes = new Set<string>(BUILTIN_SEARCH_TYPES);
  for (const t of enabled) {
    prefixes.add(t);
  }
  return prefixes;
};

export const isBuiltinSearchType = (type: string): boolean =>
  (BUILTIN_SEARCH_TYPES as readonly string[]).includes(type);
