import { asBoolean, asString } from "../settings/plugin-settings";
import { getInstanceSettings } from "../settings/server-settings";
import type { LocalImageAccess } from "./ssrf";

export const localImageAccess = async (): Promise<LocalImageAccess> => {
  const settings = await getInstanceSettings();
  return {
    enabled: asBoolean(settings.imageProxyAllowLocal),
    patterns: asString(settings.imageProxyAllowList).split("\n"),
  };
};
