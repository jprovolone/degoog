import { idbGet } from "../storage/db";
import { ENGINE_BANGS_KEY, SETTINGS_KEY } from "../../constants";
import { getBase } from "../net/base-url";
import { onWindowEvent } from "../dom/window-event";
import type { EngineRegistry } from "../../types/extension";
import type { EngineRecord } from "../../types/state";

let cachedRegistry: EngineRegistry | null = null;
let inflightRegistry: Promise<EngineRegistry> | null = null;

onWindowEvent("extensions-saved", () => {
  cachedRegistry = null;
  inflightRegistry = null;
});

export const getRegistry = async (): Promise<EngineRegistry> => {
  if (cachedRegistry) return cachedRegistry;
  if (!inflightRegistry) {
    const request: Promise<EngineRegistry> = fetch(`${getBase()}/api/engines`)
      .then((res) => {
        if (!res.ok) throw new Error(`engines request failed: ${res.status}`);
        return res.json() as Promise<EngineRegistry>;
      })
      .then((data) => {
        cachedRegistry = data;
        if (inflightRegistry === request) inflightRegistry = null;
        return data;
      })
      .catch((err: unknown) => {
        if (inflightRegistry === request) inflightRegistry = null;
        throw err;
      });
    inflightRegistry = request;
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

export const getEngineBangs = async (): Promise<EngineRecord> => {
  const saved = (await idbGet<EngineRecord>(ENGINE_BANGS_KEY)) ?? {};
  const reg = await getRegistry();
  const merged: EngineRecord = {};
  for (const { id } of reg.engines) {
    merged[id] = saved[id] ?? reg.bangDefaults?.[id] ?? true;
  }
  return merged;
};

export const enabledIds = (record: EngineRecord): string[] =>
  Object.entries(record)
    .filter(([, on]) => on)
    .map(([id]) => id);

const _typesForEngine = (engine: {
  searchTypes?: string[];
  primaryType?: string;
}): string[] => {
  if (engine.searchTypes?.length) return engine.searchTypes;
  if (engine.primaryType) return [engine.primaryType];
  return ["web"];
};

export const getAllSearchTypes = async (): Promise<Set<string>> => {
  const types = new Set<string>();
  const reg = await getRegistry();
  for (const engine of reg.engines) {
    for (const t of _typesForEngine(engine)) {
      types.add(t);
    }
  }
  return types;
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
  const prefixes = new Set<string>();
  for (const t of enabled) {
    prefixes.add(t);
  }
  return prefixes;
};

