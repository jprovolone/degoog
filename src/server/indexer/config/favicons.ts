import { asBoolean, asString } from "../../utils/settings/plugin-settings";
import type { ServerSettingValue } from "../../utils/settings/server-settings";
import { SETTINGS_SCHEMA } from "../../utils/settings/settings-schema";

export interface FaviconStoreConfig {
  enabled: boolean;
  maxAgeDays: number;
}

export const FAVICON_STORE_MIN_AGE_DAYS = 1;
export const FAVICON_STORE_MAX_AGE_DAYS = 3650;

const _storeToggle = (raw: ServerSettingValue | undefined): boolean =>
  raw === undefined || raw === ""
    ? SETTINGS_SCHEMA.degoogFaviconStoreEnabled.default
    : asBoolean(raw);

const _maxAgeDays = (raw: ServerSettingValue | undefined): number => {
  const fallback = Number(SETTINGS_SCHEMA.degoogFaviconStoreMaxAgeDays.default);
  const parsed = Number.parseInt(asString(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(FAVICON_STORE_MAX_AGE_DAYS, Math.max(FAVICON_STORE_MIN_AGE_DAYS, parsed));
};

export const faviconStoreConfig = (
  settings: Record<string, ServerSettingValue | undefined>,
): FaviconStoreConfig => ({
  enabled:
    asBoolean(settings.degoogIndexerEnabled) &&
    _storeToggle(settings.degoogFaviconStoreEnabled),
  maxAgeDays: _maxAgeDays(settings.degoogFaviconStoreMaxAgeDays),
});
