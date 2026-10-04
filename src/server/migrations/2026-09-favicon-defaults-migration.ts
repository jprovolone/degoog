import { readFile, stat } from "fs/promises";
import { join } from "path";
import { ExtensionStoreType } from "../types/extension";
import type { RepoPackageJson } from "../types/store";
import { OFFICIAL_REPO_URL } from "../../shared/official-repo";
import { logger } from "../utils/logger";
import { pluginSettingsFile } from "../utils/paths";
import {
  didSettingsLoadFail,
  getMetaList,
  getSchemaVersion,
  getSettings,
  setMetaList,
  setSchemaVersion,
  setSettings,
} from "../utils/settings/plugin-settings";
import { folderNameForItem, makeExtID } from "../utils/extension-support/extension-id";
import { getFaviconProviderById } from "../extensions/favicon/registry";
import { getInstalledItems, installItem } from "../extensions/store/item-lifecycle";
import { reloadAfterAction, getEntriesForType } from "../extensions/store/item-specs";
import { addRepo, getRepos, refreshRepo } from "../extensions/store/repo-ops";
import { getStoreDir, normalizeRepoUrl } from "../extensions/store/persistence";

const MIGRATION_VERSION = 93026 as const;
const CANONICAL_IDS_VERSION = 52028 as const;
const LOG_TAG = "migrations";
const DONE_KEY = "__faviconDefaultsDone";

export const FAVICON_DEFAULT_ITEMS = ["favicon/google", "favicon/duckduckgo"] as const;

export interface FaviconMigrationDeps {
  ensureOfficialRepo: () => Promise<void>;
  isInstalled: (itemPath: string) => Promise<boolean>;
  install: (itemPath: string) => Promise<void>;
  reload: () => Promise<void>;
}

const _sameRepo = (a: string, b: string): boolean =>
  normalizeRepoUrl(a) === normalizeRepoUrl(b);

export const faviconDefaultId = (itemPath: string): string =>
  makeExtID(folderNameForItem(OFFICIAL_REPO_URL, itemPath), "favicon");

const _officialListsDefaults = async (localPath: string): Promise<boolean> => {
  try {
    const raw = await readFile(join(getStoreDir(), localPath, "package.json"), "utf-8");
    const listed = new Set(
      (getEntriesForType(JSON.parse(raw) as RepoPackageJson, ExtensionStoreType.Favicon) ?? [])
        .map((e) => e.path.replace(/\/$/, "")),
    );
    return FAVICON_DEFAULT_ITEMS.every((item) => listed.has(item));
  } catch (err) {
    logger.debug(LOG_TAG, "official repo manifest unreadable", err);
    return false;
  }
};

async function _ensureOfficialRepo(): Promise<void> {
  let official = (await getRepos()).find((r) => _sameRepo(r.url, OFFICIAL_REPO_URL));
  if (!official) official = await addRepo(OFFICIAL_REPO_URL);
  if (!(await _officialListsDefaults(official.localPath))) {
    await refreshRepo(official.url);
  }
}

const _isInstalled = async (itemPath: string): Promise<boolean> => {
  if (getFaviconProviderById(faviconDefaultId(itemPath))) return true;
  const installed = await getInstalledItems();
  return installed.some(
    (i) =>
      _sameRepo(i.repoUrl, OFFICIAL_REPO_URL) &&
      i.type === ExtensionStoreType.Favicon &&
      i.itemPath === itemPath,
  );
};

const DEFAULT_DEPS: FaviconMigrationDeps = {
  ensureOfficialRepo: _ensureOfficialRepo,
  isInstalled: _isInstalled,
  install: (itemPath) =>
    installItem(OFFICIAL_REPO_URL, itemPath, ExtensionStoreType.Favicon),
  reload: () => reloadAfterAction(ExtensionStoreType.Favicon, false),
};

const _settingsFileExists = async (): Promise<boolean> => {
  try {
    await stat(pluginSettingsFile());
    return true;
  } catch {
    return false;
  }
};

async function _applyDefaultPriorities(): Promise<void> {
  const total = FAVICON_DEFAULT_ITEMS.length;
  for (let i = 0; i < total; i++) {
    const id = faviconDefaultId(FAVICON_DEFAULT_ITEMS[i]);
    const stored = await getSettings(id);
    if (stored.priority !== undefined) continue;
    await setSettings(id, { priority: String(total - 1 - i) });
  }
}

const _installDefaults = async (deps: FaviconMigrationDeps): Promise<boolean> => {
  let ok = true;
  const done = await getMetaList(DONE_KEY);
  for (const itemPath of FAVICON_DEFAULT_ITEMS) {
    if (done.includes(itemPath)) continue;
    try {
      if (!(await deps.isInstalled(itemPath))) {
        await deps.install(itemPath);
        logger.info(LOG_TAG, `installed default favicon provider ${itemPath}`);
      }
      done.push(itemPath);
      await setMetaList(DONE_KEY, done);
    } catch (err) {
      ok = false;
      logger.warn(LOG_TAG, `favicon default install failed for ${itemPath}`, err);
    }
  }
  return ok;
};

export const runFaviconDefaultsMigration093026 = async (
  deps: FaviconMigrationDeps = DEFAULT_DEPS,
): Promise<void> => {
  try {
    const version = await getSchemaVersion();
    if (didSettingsLoadFail()) {
      logger.warn(LOG_TAG, "plugin settings unreadable, skipping favicon defaults migration");
      return;
    }
    if (version >= MIGRATION_VERSION) return;
    if (version < CANONICAL_IDS_VERSION && (await _settingsFileExists())) {
      logger.warn(
        LOG_TAG,
        `canonical ids migration unfinished (schema ${version}), skipping favicon defaults migration`,
      );
      return;
    }

    await deps.ensureOfficialRepo();
    if (!(await _installDefaults(deps))) {
      logger.warn(LOG_TAG, "favicon defaults migration incomplete, retrying on next boot");
      return;
    }

    await _applyDefaultPriorities();
    await deps.reload();
    await setSchemaVersion(MIGRATION_VERSION);
    logger.info(LOG_TAG, `favicon defaults migration done (schema ${MIGRATION_VERSION})`);
  } catch (err) {
    logger.warn(LOG_TAG, "favicon defaults migration failed, retrying on next boot", err);
  }
};
