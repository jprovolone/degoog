import type { EngineFilters } from "../../shared/engine-filters";
import type { SettingField } from "../../shared/setting-field";

export type {
  FieldOption,
  FieldOptionsResult,
  FieldOptionsSource,
} from "../../shared/field-options";

export type { SettingFieldType, SettingField } from "../../shared/setting-field";

export interface ExtensionMeta {
  id: string;
  displayName: string;
  description: string;
  primaryType?: string;
  searchTypes?: string[];
  type: string;
  trigger?: string;
  configurable: boolean;
  settingsSchema: SettingField[];
  settings: Record<string, string | string[]>;
  source?: "builtin" | "plugin";
  compatibilityLayer?: string;
  extensionDocsAvailable?: boolean;
  defaultEnabled?: boolean;
  defaultFeedUrls?: string[];
  isClientExposed?: boolean;
  requiresNewerVersion?: boolean;
  needsAppRestart?: boolean;
}

export interface AllExtensions {
  engines: ExtensionMeta[];
  plugins: ExtensionMeta[];
  themes: ExtensionMeta[];
  transports: ExtensionMeta[];
  autocomplete: ExtensionMeta[];
  shortcuts: ExtensionMeta[];
}

export interface SearchBarAction {
  id: string;
  label: string;
  icon?: string;
  type: "navigate" | "bang" | "custom";
  url?: string;
  trigger?: string;
}

export interface Command {
  id: string;
  trigger: string;
  aliases?: string[];
  naturalLanguage?: boolean;
  naturalLanguagePhrases?: string[];
}

export interface EngineRegistry {
  engines: Array<{
    id: string;
    displayName: string;
    primaryType: string;
    searchTypes: string[];
    disabledByDefault?: boolean;
    filters?: EngineFilters;
  }>;
  defaults?: Record<string, boolean>;
}
