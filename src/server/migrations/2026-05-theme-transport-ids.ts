import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "fs/promises";
import { dirname, join } from "path";
import { logger } from "../utils/logger";
import {
  autocompleteDir,
  pluginSettingsFile,
  themesDir,
} from "../utils/paths";
import { folderNameForItem } from "../utils/extension-id";
import { makeExtID } from "../extensions/extension-id";
import {
  getReposPath,
  getStoreDir,
  readReposData,
  writeReposData,
} from "../extensions/store/persistence";
import { slugFromUrl } from "../extensions/store/repo-ops";
import {
  ExtensionStoreType,
  type RepoPackageJson,
  type ReposData,
} from "../types";

export const MIGRATION_VERSION = 52028 as const;
const SCHEMA_KEY = "__schemaVersion";

const RESERVED_KEYS = new Set<string>([
  "theme",
  "degoog-api-secret",
  "middleware",
]);

const OFFICIAL_THEME_OVERRIDES: Record<string, string> = {
  catpuccin: "degoog-org-official-extensions-catpuccin-theme",
  "degoog-docs": "degoog-org-official-extensions-degoog-docs-theme",
  pokemon: "degoog-org-official-extensions-pokemon-theme",
  zen: "degoog-org-official-extensions-zen-theme",
};

type SettingsValue = string | string[] | boolean;
type SettingsRecord = Record<string, SettingsValue>;
type SettingsStore = Record<
  string,
  SettingsRecord | number | undefined
> & { [SCHEMA_KEY]?: number };

interface MappingData {
  aliases: Map<string, string>;
  themeAliases: Map<string, string>;
  autocompleteAliases: Map<string, string>;
}

const _readJson = async <T,>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.warn("migration:theme-transport-ids", `failed to read ${path}`, err);
    }
    return null;
  }
};

const _writeAtomic = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, contents, "utf-8");
  await rename(tmp, path);
};

const _backupPath = (path: string): string =>
  `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const _exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const _listDirs = async (path: string): Promise<string[]> => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

const _isSettingsRecord = (
  value: SettingsStore[string],
): value is SettingsRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const _addAlias = (
  aliases: Map<string, string>,
  legacy: string,
  canonical: string,
): void => {
  if (!legacy || legacy === canonical) return;
  if (!aliases.has(legacy)) aliases.set(legacy, canonical);
};

const _itemFolder = (itemPath: string): string =>
  itemPath.replace(/\/$/, "").split("/").filter(Boolean).pop() ?? itemPath;

const _collectManifestAliases = async (data: ReposData): Promise<MappingData> => {
  const storeDir = getStoreDir();
  const aliases = new Map<string, string>();
  const themeAliases = new Map<string, string>();
  const autocompleteAliases = new Map<string, string>();

  const addTheme = (legacy: string, canonical: string): void => {
    _addAlias(aliases, legacy, canonical);
    _addAlias(themeAliases, legacy, canonical);
  };
  const addAutocomplete = (legacy: string, canonical: string): void => {
    _addAlias(aliases, legacy, canonical);
    _addAlias(autocompleteAliases, legacy, canonical);
  };

  for (const [legacy, canonical] of Object.entries(OFFICIAL_THEME_OVERRIDES)) {
    addTheme(legacy, canonical);
    addTheme(makeExtID(legacy, "theme"), canonical);
  }

  for (const repo of data.repos) {
    const local = repo.localPath ?? slugFromUrl(repo.url);
    const pkg = await _readJson<RepoPackageJson>(join(storeDir, local, "package.json"));
    if (!pkg) continue;

    for (const ent of pkg.themes ?? []) {
      if (!ent?.path) continue;
      const folder = _itemFolder(ent.path);
      const base = folderNameForItem(repo.url, ent.path);
      const canonical = makeExtID(base, "theme");
      addTheme(folder, canonical);
      addTheme(base, canonical);
      addTheme(makeExtID(folder, "theme"), canonical);
      addTheme(makeExtID(base, "theme"), canonical);
      addTheme(`${local}-${folder}`, canonical);
      addTheme(makeExtID(`${local}-${folder}`, "theme"), canonical);
      if (ent.name) addTheme(ent.name, canonical);
    }

    for (const ent of pkg.autocomplete ?? []) {
      if (!ent?.path) continue;
      const legacyIds = (ent as { legacyIds?: string[] }).legacyIds;
      const folder = _itemFolder(ent.path);
      const base = folderNameForItem(repo.url, ent.path);
      const canonical = makeExtID(base, "autocomplete");
      addAutocomplete(folder, canonical);
      addAutocomplete(base, canonical);
      addAutocomplete(`autocomplete-${folder}`, canonical);
      addAutocomplete(`autocomplete-${base}`, canonical);
      addAutocomplete(makeExtID(folder, "autocomplete"), canonical);
      addAutocomplete(makeExtID(base, "autocomplete"), canonical);
      if (Array.isArray(legacyIds)) {
        for (const legacy of legacyIds) {
          if (legacy.trim()) addAutocomplete(legacy.trim(), canonical);
        }
      }
    }
  }

  for (const item of data.installed) {
    if (
      item.type !== ExtensionStoreType.Theme &&
      item.type !== ExtensionStoreType.Autocomplete
    ) {
      continue;
    }
    const base = folderNameForItem(item.repoUrl, item.itemPath);
    if (item.type === ExtensionStoreType.Theme) {
      const canonical = makeExtID(base, "theme");
      addTheme(item.installedAs, canonical);
      addTheme(base, canonical);
      addTheme(_itemFolder(item.itemPath), canonical);
      addTheme(makeExtID(item.installedAs, "theme"), canonical);
    } else {
      const canonical = makeExtID(base, "autocomplete");
      addAutocomplete(item.installedAs, canonical);
      addAutocomplete(base, canonical);
      addAutocomplete(_itemFolder(item.itemPath), canonical);
      addAutocomplete(`autocomplete-${item.installedAs}`, canonical);
      addAutocomplete(`autocomplete-${base}`, canonical);
    }
  }

  return { aliases, themeAliases, autocompleteAliases };
};

const _syncInstalledAs = async (data: ReposData): Promise<boolean> => {
  let changed = false;

  for (const item of data.installed) {
    if (
      item.type !== ExtensionStoreType.Theme &&
      item.type !== ExtensionStoreType.Autocomplete
    ) {
      continue;
    }
    const base = folderNameForItem(item.repoUrl, item.itemPath);
    const expected =
      item.type === ExtensionStoreType.Theme
        ? makeExtID(base, "theme")
        : makeExtID(base, "autocomplete");
    if (item.installedAs === expected) continue;
    logger.info(
      "migration:theme-transport-ids",
      `installedAs "${item.installedAs}" -> "${expected}" (${item.itemPath})`,
    );
    item.installedAs = expected;
    changed = true;
  }

  if (!changed) return false;

  const reposPath = getReposPath();
  try {
    const raw = await readFile(reposPath, "utf-8");
    await writeFile(_backupPath(reposPath), raw, "utf-8");
  } catch (err) {
    logger.error(
      "migration:theme-transport-ids",
      "failed to write repos.json backup, aborting installedAs sync",
      err,
    );
    return false;
  }

  await writeReposData(data);
  return true;
};

const _renameFolders = async (
  dir: string,
  aliases: Map<string, string>,
  kind: "theme" | "autocomplete",
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  for (const folder of await _listDirs(dir)) {
    const canonical = aliases.get(folder) ?? makeExtID(folder, kind);
    if (folder === canonical) continue;
    const src = join(dir, folder);
    const dst = join(dir, canonical);
    if (await _exists(dst)) {
      logger.warn(
        "migration:theme-transport-ids",
        `target ${dst} already exists; leaving "${folder}" in place`,
      );
      continue;
    }
    try {
      await rename(src, dst);
      logger.info(
        "migration:theme-transport-ids",
        `renamed ${kind}/${folder} -> ${kind}/${canonical}`,
      );
    } catch (err) {
      logger.error(
        "migration:theme-transport-ids",
        `failed to rename ${src} -> ${dst}`,
        err,
      );
    }
  }
};

const _merge = (
  store: SettingsStore,
  legacyKey: string,
  canonicalId: string,
): boolean => {
  if (legacyKey === canonicalId) return false;
  const legacyVal = store[legacyKey];
  if (!_isSettingsRecord(legacyVal)) return false;
  const currentCanonicalVal = store[canonicalId];
  const canonicalVal = _isSettingsRecord(currentCanonicalVal)
    ? currentCanonicalVal
    : {};
  store[canonicalId] = { ...legacyVal, ...canonicalVal };
  delete store[legacyKey];
  logger.info("migration:theme-transport-ids", `rewrote "${legacyKey}" -> "${canonicalId}"`);
  return true;
};

const _canonicalSettingId = (
  key: string,
  mappings: MappingData,
): string | null => {
  if (RESERVED_KEYS.has(key)) return null;
  if (key.startsWith("transport-")) {
    const rest = key.slice("transport-".length);
    return rest.endsWith("-transport") ? rest : makeExtID(rest, "transport");
  }
  if (key.startsWith("theme-")) {
    const rest = key.slice("theme-".length);
    return mappings.themeAliases.get(rest) ?? makeExtID(rest, "theme");
  }
  if (key.startsWith("autocomplete-")) {
    const rest = key.slice("autocomplete-".length);
    return mappings.autocompleteAliases.get(rest) ?? makeExtID(rest, "autocomplete");
  }
  if (key.endsWith("-theme") || key.endsWith("-transport") || key.endsWith("-autocomplete")) {
    return mappings.aliases.get(key) ?? null;
  }
  return mappings.aliases.get(key) ?? null;
};

export const runThemeTransportIds052028 = async (): Promise<void> => {
  const reposData = await readReposData();
  const mappings = await _collectManifestAliases(reposData);

  await _renameFolders(themesDir(), mappings.themeAliases, "theme");
  await _renameFolders(autocompleteDir(), mappings.autocompleteAliases, "autocomplete");
  await _syncInstalledAs(reposData);

  const settingsPath = pluginSettingsFile();
  const store = await _readJson<SettingsStore>(settingsPath);
  if (!store) return;

  const existingVersion =
    typeof store[SCHEMA_KEY] === "number" ? (store[SCHEMA_KEY] as number) : 0;
  if (existingVersion >= MIGRATION_VERSION) return;

  const keys = Object.keys(store).filter((k) => !k.startsWith("__"));
  const rewrites: Array<{ legacyKey: string; canonicalId: string }> = [];

  for (const key of keys) {
    const canonicalId = _canonicalSettingId(key, mappings);
    if (canonicalId) rewrites.push({ legacyKey: key, canonicalId });
  }

  const themeSettings = store.theme;
  if (_isSettingsRecord(themeSettings)) {
    const active = typeof themeSettings.active === "string" ? themeSettings.active : "";
    const canonicalActive =
      mappings.themeAliases.get(active) ??
      (active ? makeExtID(active, "theme") : "");
    if (active && canonicalActive !== active) {
      store.theme = { ...themeSettings, active: canonicalActive };
    }
  }

  if (rewrites.length === 0) {
    store[SCHEMA_KEY] = MIGRATION_VERSION;
    await _writeAtomic(settingsPath, JSON.stringify(store, null, 2));
    return;
  }

  const backup = _backupPath(settingsPath);
  try {
    const raw = await readFile(settingsPath, "utf-8");
    await writeFile(backup, raw, "utf-8");
    logger.info("migration:theme-transport-ids", `wrote backup ${backup}`);
  } catch (err) {
    logger.error("migration:theme-transport-ids", "failed to write backup, aborting rewrite", err);
    return;
  }

  for (const { legacyKey, canonicalId } of rewrites) {
    _merge(store, legacyKey, canonicalId);
  }

  store[SCHEMA_KEY] = MIGRATION_VERSION;
  await _writeAtomic(settingsPath, JSON.stringify(store, null, 2));
};
