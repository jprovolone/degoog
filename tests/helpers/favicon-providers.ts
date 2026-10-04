import { mock } from "bun:test";
import type { FaviconResult } from "../../src/server/types/extension";

const REGISTRY_MOD = "../../src/server/extensions/favicon/registry";

type RegistryModule = typeof import("../../src/server/extensions/favicon/registry");

const registryReal: RegistryModule = { ...(await import(REGISTRY_MOD)) };

export const fakeFaviconProviders = (
  enabled: boolean,
  chain?: (host: string) => Promise<FaviconResult>,
): void => {
  mock.module(REGISTRY_MOD, () => ({
    ...registryReal,
    hasFaviconProviders: () => enabled,
    runFaviconChain: async <T>(
      host: string,
      accept: (result: NonNullable<FaviconResult>) => Promise<T | null> | T | null,
    ): Promise<T | null> => {
      const result = chain ? await chain(host) : null;
      if (!result) return null;
      return accept(result);
    },
  }));
};

export const restoreFaviconProviders = (): void => {
  mock.module(REGISTRY_MOD, () => registryReal);
};
