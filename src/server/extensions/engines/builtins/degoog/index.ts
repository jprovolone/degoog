import type { EngineContext, SearchResult } from "../../../../types";
import {
  DEGOOG_ENGINE_NAME,
  getKnownTypes,
  queryIndex,
} from "../../../../indexer/store";
import { listEngines } from "../../registry";
import { asBoolean } from "../../../../utils/plugin-settings";
import { getInstanceSettings } from "../../../../utils/server-settings";

const isEnabled = async (): Promise<boolean> => {
  const settings = await getInstanceSettings();
  return asBoolean(settings.degoogIndexerEnabled);
};

export const name = DEGOOG_ENGINE_NAME;
export const description =
  "Re-surfaces results from your local Degoog index. Toggle on in Settings > Degoog Indexer.";
export const bangShortcut = "degoog";

export const type = async (): Promise<string[]> => {
  const seen = new Set<string>();
  const engines = await listEngines();
  for (const e of engines) {
    for (const t of e.searchTypes) seen.add(t);
  }
  for (const t of getKnownTypes()) seen.add(t);
  return [...seen];
};

export const executeSearch = async (
  query: string,
  _page?: number,
  _timeFilter?: string,
  context?: EngineContext,
): Promise<SearchResult[]> => {
  if (!(await isEnabled())) return [];
  const engineType = context?.searchType;
  if (!engineType) return [];
  return queryIndex(query, engineType);
};
