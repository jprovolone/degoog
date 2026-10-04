import {
  INVALIDATE_SCOPE,
  isOwnEvent,
  onInvalidate,
  publishInvalidate,
  type InvalidatePayload,
} from "../utils/cache/cache-valkey";
import { logger } from "../utils/logger";
import {
  getSettings,
  mergeDefaults,
  type SettingValue,
} from "../utils/settings/plugin-settings";
import type { SettingField } from "../../shared/setting-field";
import { reconfigureManifestEngines } from "./engines/catalog";
import { engineFullSchema } from "./engines/engine-settings";
import { applyFaviconSettings } from "./favicon/registry";
import { resolveExtension } from "./resolve";

type ExtSettings = Record<string, SettingValue>;

const NS = "settings-sync";

type Configurable = {
  configure?: (settings: ExtSettings) => void;
  settingsSchema?: SettingField[];
};

const _withDefaults = (
  target: Configurable | null,
  settings: ExtSettings,
  schema: SettingField[] | undefined = target?.settingsSchema,
): void => {
  target?.configure?.(mergeDefaults(settings, schema ?? []));
};

const applyExtSettings = (id: string, settings: ExtSettings): void => {
  const resolved = resolveExtension(id);
  const { engine } = resolved;
  if (engine && !engine.pluginManifest) {
    _withDefaults(engine, settings, engineFullSchema(engine));
  }
  _withDefaults(resolved.command, settings);
  _withDefaults(resolved.slot, settings);
  _withDefaults(resolved.interceptor, settings);
  _withDefaults(resolved.tab, settings);
  resolved.transport?.configure?.(settings);
  _withDefaults(resolved.autocomplete, settings);
  if (resolved.favicon) applyFaviconSettings(id, settings);

  if (settings.priority === undefined) return;

  const parsed = parseInt(String(settings.priority), 10);
  const priority = isNaN(parsed) ? 0 : parsed;
  if (resolved.slot) resolved.slot.priority = priority;
  if (resolved.interceptor) resolved.interceptor.priority = priority;
};

export const syncExtSettings = async (
  id: string,
  settings: ExtSettings,
): Promise<void> => {
  applyExtSettings(id, settings);
  await reconfigureManifestEngines(id);
  await publishInvalidate(INVALIDATE_SCOPE.EXTENSION_SETTINGS, id);
};

const reapplyStored = async (id: string): Promise<void> => {
  applyExtSettings(id, await getSettings(id));
  await reconfigureManifestEngines(id);
};

export const palantir = (payload: InvalidatePayload): void => {
  if (
    payload.scope !== INVALIDATE_SCOPE.EXTENSION_SETTINGS ||
    isOwnEvent(payload)
  ) {
    return;
  }

  const id = payload.key;
  if (!id) {
    logger.warn(NS, "ignoring settings event without an extension id");
    return;
  }

  reapplyStored(id).catch((err) =>
    logger.error(NS, `failed to apply synced settings for ${id}`, err),
  );
};

export const openPalantir = (): (() => void) => onInvalidate(palantir);
