import { search, searchSingleEngine } from "./index";
import { scoreResults } from "./scoring";
import type { SearchParams } from "../types/search";
import { signResultThumbnails } from "../utils/net/proxy-sign";
import { applyMergedDomainRules, rewriteEngineRuns } from "./domain-rules";
import { resolveSearchOverrides } from "./overrides";
import { recordIndexBasis } from "./indexing";
import { getInstanceSettings } from "../utils/settings/server-settings";
import { asBoolean } from "../utils/settings/plugin-settings";
import { tagIndexRelation } from "../indexer/store/record";
import { DEGOOG_ENGINE_NAME } from "../../shared/search-types";
import { selectActiveEngines } from "./engine-selection";
import { agreedPageTotal } from "./page-counter";
import {
  isCacheable,
  readActiveRuns,
  type RunScope,
} from "./engine-cache";

export async function handleSearch(params: SearchParams) {
  const {
    query: origQ,
    engines,
    searchType,
    page,
    timeFilter,
    lang,
    dateFrom,
    dateTo,
    imageFilter,
  } = params;

  const {
    query,
    type,
    lang: resolvedLang,
    timeFilter: resolvedTime,
  } = await resolveSearchOverrides(origQ, searchType, lang, timeFilter);

  const { indexBasis, ...response } = await search(
    query,
    engines,
    type,
    page,
    resolvedTime,
    resolvedLang,
    dateFrom,
    dateTo,
    imageFilter,
  );

  const settings = await getInstanceSettings();

  const displayResults = await applyMergedDomainRules(response.results);
  const indexedUrls = await recordIndexBasis(
    asBoolean(settings.degoogIndexerEnabled),
    query,
    type,
    await applyMergedDomainRules(indexBasis),
    { lang: resolvedLang, timeFilter: resolvedTime, dateFrom, dateTo, imageFilter },
  );

  return {
    ...response,
    results: signResultThumbnails(
      tagIndexRelation(displayResults, new Set(indexedUrls)),
    ),
  };
}

export async function handleRetry(
  params: SearchParams & { engineName: string },
) {
  const {
    query: origQ,
    engineName,
    engines,
    searchType,
    page,
    timeFilter,
    lang,
    dateFrom,
    dateTo,
    imageFilter,
  } = params;

  const {
    query,
    type,
    lang: resolvedLang,
    timeFilter: resolvedTime,
  } = await resolveSearchOverrides(origQ, searchType, lang, timeFilter);

  const {
    results: newResults,
    timing,
    pages: retriedPages,
  } = await searchSingleEngine(
    engineName,
    query,
    page,
    resolvedTime,
    resolvedLang,
    dateFrom,
    dateTo,
    imageFilter,
    undefined,
    type,
    { forceFresh: true },
  );

  const scope: RunScope = {
    query,
    type,
    page,
    timeFilter: resolvedTime,
    lang: resolvedLang,
    dateFrom,
    dateTo,
    imageFilter,
  };
  const active = await selectActiveEngines(type, engines, imageFilter);
  const isRetried = (entry: { id: string; instance: { name: string } }): boolean =>
    timing.id ? entry.id === timing.id : entry.instance.name === timing.name;
  const retried = active.find(isRetried);
  const others = active.filter((e) => !isRetried(e));

  const liveRuns = await Promise.all(
    others
      .filter((e) => !isCacheable(e.instance.name))
      .map(async (engine) => ({
        engine,
        run: await searchSingleEngine(
          engine.id,
          query,
          page,
          resolvedTime,
          resolvedLang,
          dateFrom,
          dateTo,
          imageFilter,
          undefined,
          type,
        ),
      })),
  );
  const knownRuns = [...(await readActiveRuns(others, scope)), ...liveRuns];

  const runs = await rewriteEngineRuns([
    ...knownRuns.map(({ engine, run }) => ({
      results: run.results,
      multiplier: engine.score,
      name: engine.instance.name,
    })),
    { results: newResults, multiplier: retried?.score ?? 1, name: timing.name },
  ]);
  const merged = scoreResults(runs);
  const engineTimings = [...knownRuns.map(({ run }) => run.timing), timing];

  const settings = await getInstanceSettings();
  const displayMerged = await applyMergedDomainRules(merged);
  const indexedUrls = await recordIndexBasis(
    asBoolean(settings.degoogIndexerEnabled),
    query,
    type,
    await applyMergedDomainRules(
      scoreResults(runs.filter((r) => r.name !== DEGOOG_ENGINE_NAME)),
    ),
    { lang: resolvedLang, timeFilter: resolvedTime, dateFrom, dateTo, imageFilter },
  );

  return {
    query,
    type,
    totalTime: timing.time,
    relatedSearches: [],
    timing,
    engineTimings,
    totalPages: agreedPageTotal([
      ...others.map(
        (engine) => knownRuns.find((known) => known.engine === engine)?.run.pages,
      ),
      retriedPages,
    ]),
    results: signResultThumbnails(
      tagIndexRelation(displayMerged, new Set(indexedUrls)),
    ),
  };
}
