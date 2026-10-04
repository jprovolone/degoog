import { FAVICON_SIZE } from "./size";
import type { FaviconContext, TransportFetchOptions } from "../../types/extension";
import { asString, getSettings } from "../../utils/settings/plugin-settings";
import { outgoingFetch, parseOutgoingTransport } from "../../utils/net/outgoing";
import { useCache } from "../../utils/cache/cache";
import { getRandomUserAgent } from "../../utils/net/user-agents";


export const buildFaviconContext = async (
  providerId: string,
  providerSignal: AbortSignal,
): Promise<FaviconContext> => {
  const stored = await getSettings(providerId);
  const transportName = parseOutgoingTransport(
    asString(stored.outgoingTransport) || undefined,
  );
  return {
    fetch: (url, init) => {
      const options = (init ?? {}) as TransportFetchOptions;
      return outgoingFetch(
        url,
        {
          ...options,
          signal: options.signal
            ? AbortSignal.any([providerSignal, options.signal])
            : providerSignal,
        },
        transportName,
      );
    },
    userAgent: getRandomUserAgent(),
    size: FAVICON_SIZE,
    useCache,
  };
};
