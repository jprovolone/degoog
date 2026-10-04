import { hasFaviconProviders } from "./registry";
import { peekInstanceSettings } from "../../utils/settings/server-settings";
import { faviconStoreConfig } from "../../indexer/config/favicons";

export const hasFaviconSource = (): boolean => {
  if (hasFaviconProviders()) return true;
  const settings = peekInstanceSettings();
  return settings ? faviconStoreConfig(settings).enabled : false;
};
