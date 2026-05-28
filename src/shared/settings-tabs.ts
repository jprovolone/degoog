export const SETTINGS_TABS = [
  "general",
  "server",
  "engines",
  "plugins",
  "transports",
  "autocomplete",
  "themes",
  "store",
  "indexer",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
