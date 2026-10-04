import {
  type ExtensionMeta,
  ExtensionStoreType,
  type FaviconProvider,
  type FaviconResult,
} from "../../types/extension";
import type { SettingField } from "../../../shared/setting-field";
import {
  asBoolean,
  asString,
  getSettings,
  maskSecrets,
  mergeDefaults,
  type SettingValue,
} from "../../utils/settings/plugin-settings";
import { faviconDir } from "../../utils/paths";
import { transportPicks } from "../transports/registry";
import { createRegistry } from "../registry-factory";
import { makeExtID } from "../../utils/extension-support/extension-id";
import { logger } from "../../utils/logger";
import { extensionReadmeExists } from "../../utils/extension-support/extension-docs";
import { isExtensionRestartFlagVisible } from "../../utils/extension-support/restart-state";
import {
  FAVICON_PROVIDER_TIMEOUT_MS,
  withTimeout,
} from "../../utils/net/with-timeout";
import { buildFaviconContext } from "./context";
import { forgetFaviconMisses } from "./misses";

interface FaviconEntry {
  id: string;
  displayName: string;
  instance: FaviconProvider;
  disabled: boolean;
}

const LOG_TAG = "favicon";
const OUTGOING_TRANSPORT_KEY = "outgoingTransport";

const _isFaviconProvider = (val: unknown): val is FaviconProvider =>
  typeof val === "object" &&
  val !== null &&
  typeof (val as FaviconProvider).name === "string" &&
  typeof (val as FaviconProvider).getFavicon === "function";

function _configure(entry: FaviconEntry, stored: Record<string, SettingValue>): void {
  entry.disabled = asBoolean(stored.disabled);
  if (entry.instance.configure && entry.instance.settingsSchema?.length) {
    entry.instance.configure(mergeDefaults(stored, entry.instance.settingsSchema));
  }
}

const registry = createRegistry<FaviconEntry>({
  dirs: () => [{ dir: faviconDir() }],
  match: (mod) => {
    const Export = mod.default ?? mod.provider ?? mod.Provider;
    const instance: FaviconProvider =
      typeof Export === "function"
        ? new (Export as new () => FaviconProvider)()
        : (Export as FaviconProvider);
    if (!_isFaviconProvider(instance)) return null;
    return { id: "", displayName: instance.name, instance, disabled: false };
  },
  canonicalIdKind: "favicon",
  onLoad: async (entry, { folderName, canonicalId }) => {
    entry.id = canonicalId ?? makeExtID(folderName, "favicon");
    _configure(entry, await getSettings(entry.id));
  },
  allowFlatFiles: true,
  debugTag: "favicon",
});

const OUTGOING_TRANSPORT_FIELD: SettingField = {
  key: OUTGOING_TRANSPORT_KEY,
  label: "Outgoing HTTP client",
  type: "select",
  options: ["fetch", "curl", "curl-fallback"],
  default: "fetch",
  description: "The outgoing HTTP client to use for this favicon provider.",
  advanced: true,
};

const _all = (): FaviconEntry[] => registry.items();

const UNRANKED_PRIORITY = -1;

const _priorityOf = (stored: Record<string, SettingValue>): number => {
  const parsed = parseInt(asString(stored.priority), 10);
  return isNaN(parsed) ? UNRANKED_PRIORITY : parsed;
};

const _isValidResult = (result: unknown): result is NonNullable<FaviconResult> => {
  if (typeof result !== "object" || result === null) return false;
  const candidate = result as { url?: unknown; data?: unknown; contentType?: unknown };
  if (typeof candidate.url === "string") return candidate.url.trim().length > 0;
  return (
    candidate.data instanceof Uint8Array &&
    candidate.data.byteLength > 0 &&
    typeof candidate.contentType === "string"
  );
};

const _orderedActive = async (): Promise<FaviconEntry[]> => {
  const ranked = await Promise.all(
    _all().map(async (entry, index) => {
      const stored = await getSettings(entry.id);
      return {
        entry,
        index,
        disabled: asBoolean(stored.disabled),
        priority: _priorityOf(stored),
      };
    }),
  );
  return ranked
    .filter((r) => !r.disabled)
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map((r) => r.entry);
};

const _tryProvider = async (
  entry: FaviconEntry,
  host: string,
): Promise<NonNullable<FaviconResult> | null> => {
  try {
    const ctx = await buildFaviconContext(
      entry.id,
      AbortSignal.timeout(FAVICON_PROVIDER_TIMEOUT_MS),
    );
    const result = await withTimeout(
      Promise.resolve(entry.instance.getFavicon(host, ctx)),
      FAVICON_PROVIDER_TIMEOUT_MS,
      `favicon ${entry.displayName}`,
    );
    if (result === null || result === undefined) return null;
    if (!_isValidResult(result)) {
      logger.debug(LOG_TAG, `${entry.displayName} returned an invalid result`);
      return null;
    }
    return result;
  } catch (err) {
    logger.warn(LOG_TAG, `${entry.displayName} failed`, err);
    return null;
  }
};

export const getFaviconProviderById = (id: string): FaviconProvider | undefined =>
  _all().find((p) => p.id === id)?.instance;

export const hasFaviconProviders = (): boolean =>
  _all().some((entry) => !entry.disabled);

export function applyFaviconSettings(
  id: string,
  settings: Record<string, SettingValue>,
): void {
  const entry = _all().find((p) => p.id === id);
  if (!entry) return;
  _configure(entry, settings);
  forgetFaviconMisses().catch((err: unknown) => {
    logger.warn(LOG_TAG, "could not clear cached favicon misses", err);
  });
}

export type FaviconAccept<T> = (
  result: NonNullable<FaviconResult>,
) => Promise<T | null> | T | null;

export const runFaviconChain = async <T>(
  host: string,
  accept: FaviconAccept<T>,
): Promise<T | null> => {
  try {
    const active = await _orderedActive();
    for (const entry of active) {
      const result = await _tryProvider(entry, host);
      if (!result) continue;
      const accepted = await accept(result);
      if (accepted !== null && accepted !== undefined) return accepted;
      logger.debug(LOG_TAG, `${entry.displayName} result rejected, trying the next provider`);
    }
  } catch (err) {
    logger.warn(LOG_TAG, "favicon chain failed", err);
  }
  return null;
};

export const getFaviconProviderMetas = async (): Promise<ExtensionMeta[]> => {
  const { names: transportOptions, labels: transportLabels } =
    await transportPicks();
  const results: ExtensionMeta[] = [];

  for (const p of _all()) {
    const providerSchema: SettingField[] = p.instance.settingsSchema ?? [];
    const userSchema = providerSchema.filter(
      (f) => f.key !== OUTGOING_TRANSPORT_KEY,
    );
    const transportField: SettingField = {
      ...OUTGOING_TRANSPORT_FIELD,
      options: transportOptions,
      optionLabels: transportLabels,
      default:
        providerSchema.find((f) => f.key === OUTGOING_TRANSPORT_KEY)?.default ??
        OUTGOING_TRANSPORT_FIELD.default,
    };

    const schema: SettingField[] = [transportField, ...userSchema];
    const rawSettings = await getSettings(p.id);
    const settings = maskSecrets(rawSettings, schema);

    const { exists: docsExist } = await extensionReadmeExists(p.id);

    results.push({
      id: p.id,
      displayName: p.displayName,
      description: p.instance.description ?? "",
      type: ExtensionStoreType.Favicon,
      configurable: true,
      settingsSchema: schema,
      settings,
      defaultEnabled: true,
      needsAppRestart: isExtensionRestartFlagVisible(p.instance.needsAppRestart),
      extensionDocsAvailable: docsExist,
    });
  }

  return results;
};

export async function initFavicon(bust = false): Promise<void> {
  await (bust ? registry.reload() : registry.init());
  await forgetFaviconMisses();
}
