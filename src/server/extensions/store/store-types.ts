import { ExtensionStoreType } from "../../types/extension";
import {
  pluginsDir,
  themesDir,
  enginesDir,
  transportsDir,
  autocompleteDir,
  shortcutsDir,
  faviconDir,
} from "../../utils/paths";
import {
  getPluginSettingsIds,
  prunePluginAssets,
} from "../../utils/extension-support/plugin-assets";
import { makeExtID } from "../../utils/extension-support/extension-id";
import { reloadCommands } from "../commands/registry";
import { reloadSlotPlugins } from "../slots/registry";
import { reloadInterceptors } from "../interceptors/registry";
import { reloadSearchResultTabs } from "../search-result-tabs/registry";
import { reloadSearchBarActions } from "../search-bar/registry";
import {
  initPluginRoutes,
} from "../plugin-routes/registry";
import { reloadMiddlewareRegistry } from "../middleware/registry";
import { reloadThemes } from "../themes/registry";
import { initEngines } from "../engines/loader";
import { initTransports } from "../transports/registry";
import { initAutocomplete } from "../autocomplete/registry";
import { reloadShortcutsRegistry } from "../shortcuts/registry";
import { initFavicon } from "../favicon/registry";

type ManifestKey =
  | "plugins"
  | "themes"
  | "engines"
  | "transports"
  | "autocomplete"
  | "shortcuts"
  | "favicon";

interface StoreTypeSpec {
  destDir: () => string;
  manifestKey: ManifestKey;
  reload: (bust: boolean) => Promise<void>;
  settingsIds: (installedAs: string) => string[];
}

const reloadPluginBundle = async (bust: boolean): Promise<void> => {
  await reloadSlotPlugins(bust);
  await reloadInterceptors(bust);
  await reloadSearchResultTabs(bust);
  await reloadCommands(bust);
  await reloadSearchBarActions(bust);
  await reloadMiddlewareRegistry(bust);
  await initPluginRoutes(bust);
  prunePluginAssets(pluginsDir());
};

const pluginSettingsIds = (installedAs: string): string[] => {
  const ids = new Set<string>(getPluginSettingsIds(installedAs));
  ids.add(makeExtID(installedAs, "command"));
  return [...ids];
};

export const STORE_TYPE_SPECS: Record<ExtensionStoreType, StoreTypeSpec> = {
  [ExtensionStoreType.Plugin]: {
    destDir: pluginsDir,
    manifestKey: "plugins",
    reload: reloadPluginBundle,
    settingsIds: pluginSettingsIds,
  },
  [ExtensionStoreType.Theme]: {
    destDir: themesDir,
    manifestKey: "themes",
    reload: reloadThemes,
    settingsIds: (id) => [makeExtID(id, "theme")],
  },
  [ExtensionStoreType.Engine]: {
    destDir: enginesDir,
    manifestKey: "engines",
    reload: initEngines,
    settingsIds: (id) => [makeExtID(id, "engine")],
  },
  [ExtensionStoreType.Transport]: {
    destDir: transportsDir,
    manifestKey: "transports",
    reload: initTransports,
    settingsIds: (id) => [makeExtID(id, "transport")],
  },
  [ExtensionStoreType.Autocomplete]: {
    destDir: autocompleteDir,
    manifestKey: "autocomplete",
    reload: initAutocomplete,
    settingsIds: (id) => [makeExtID(id, "autocomplete")],
  },
  [ExtensionStoreType.Shortcut]: {
    destDir: shortcutsDir,
    manifestKey: "shortcuts",
    reload: reloadShortcutsRegistry,
    settingsIds: (id) => [makeExtID(id, "shortcut")],
  },
  [ExtensionStoreType.Favicon]: {
    destDir: faviconDir,
    manifestKey: "favicon",
    reload: initFavicon,
    settingsIds: (id) => [makeExtID(id, "favicon")],
  },
};
