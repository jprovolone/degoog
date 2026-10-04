import {
  getDefaultEngineBangConfig,
  getEngineSearchType,
  singleEngineConfig,
} from "../extensions/engines/catalog";
import { listEngineIds } from "../extensions/engines/loader";
import type { EngineConfig } from "../types/search";
import { isDisabled } from "../utils/settings/plugin-settings";

export interface EngineBangPlan {
  engines: EngineConfig;
  searchType: string;
}

const _bangList = (raw: unknown): string[] | null => {
  if (typeof raw === "string") return raw.split(",");
  if (Array.isArray(raw))
    return raw.filter((id): id is string => typeof id === "string");
  return null;
};

export const parseEngineBangs = (raw: unknown): EngineConfig => {
  const list = _bangList(raw);
  if (!list) return getDefaultEngineBangConfig();
  const allowed = new Set(list.map((id) => id.trim()));
  return Object.fromEntries(listEngineIds().map((id) => [id, allowed.has(id)]));
};

export const isEngineBangAllowed = async (
  engineId: string,
  bangs: EngineConfig,
): Promise<boolean> => !!bangs[engineId] && !(await isDisabled(engineId));

export const planEngineBang = async (
  engineId: string,
  bangs: EngineConfig,
  preferredType?: string,
): Promise<EngineBangPlan | null> => {
  if (!(await isEngineBangAllowed(engineId, bangs))) return null;
  return {
    engines: singleEngineConfig(engineId),
    searchType: (await getEngineSearchType(engineId, preferredType)) ?? "web",
  };
};
