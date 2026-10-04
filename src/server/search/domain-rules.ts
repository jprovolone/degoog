import {
  applyDomainReplacements,
  applyDomainScores,
  filterBlockedDomains,
} from "../utils/filtering/domain-filter";
import type { ScoredResult, SearchResult } from "../../shared/search-types";

export async function applyDomainRules(
  results: ScoredResult[],
): Promise<ScoredResult[]> {
  const afterBlock = await filterBlockedDomains(results);
  const afterReplace = await applyDomainReplacements(afterBlock);
  return applyDomainScores(afterReplace);
}

export const rewriteEngineRuns = async <T extends { results: SearchResult[] }>(
  runs: T[],
): Promise<T[]> =>
  Promise.all(
    runs.map(async (run) => ({
      ...run,
      results: await applyDomainReplacements(await filterBlockedDomains(run.results)),
    })),
  );

export const applyMergedDomainRules = (
  results: ScoredResult[],
): Promise<ScoredResult[]> => applyDomainScores(results);
