import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { logger } from "../logger";
import { serverSettingsFile } from "../paths";
import { writeJsonAtomic } from "../storage/atomic-json";
import { readJsonOrQuarantine } from "../storage/read-json";
import {
  INVALIDATE_SCOPE,
  onInvalidate,
  publishInvalidate,
} from "../cache/cache-valkey";
import type { SettingValue } from "./plugin-settings";

const WIZARD_ENV_VAR = "DEGOOG_WIZARD";

export const isWizardDisabled = (): boolean =>
  String(process.env[WIZARD_ENV_VAR] ?? "").toLowerCase() === "false";

export type ServerSettingValue = SettingValue;

interface ServerSettings {
  wizard: boolean;
  instanceId: string;
  settings: Record<string, ServerSettingValue>;
  corruptRecoveredAt?: string;
}

const _defaults = (): ServerSettings => ({
  wizard: false,
  instanceId: randomBytes(16).toString("hex"),
  settings: {},
});

let _cache: ServerSettings | null = null;

onInvalidate((payload) => {
  if (payload.scope !== INVALIDATE_SCOPE.SERVER_SETTINGS) return;
  _cache = null;
});

export const clearServerSettingsCache = (): void => {
  _cache = null;
};

export const peekInstanceSettings = (): Record<string, ServerSettingValue> | null =>
  _cache?.settings ?? null;

const _persist = async (settings: ServerSettings): Promise<void> => {
  await writeJsonAtomic(serverSettingsFile(), settings);
};

export const readServerSettings = async (): Promise<ServerSettings> => {
  if (_cache) return _cache;
  const existed = existsSync(serverSettingsFile());
  const parsed = await readJsonOrQuarantine<Partial<ServerSettings>>(
    "server-settings",
    serverSettingsFile(),
  );

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const fresh = _defaults();
    if (existed) {
      fresh.corruptRecoveredAt = new Date().toISOString();
      logger.error(
        "server-settings",
        "server-settings.json was unreadable, so search and autocomplete refuse every request " +
          "until it is restored by hand or an admin saves settings again.",
      );
    }
    await _persist(fresh).catch((e) =>
      logger.error(
        "server-settings",
        "failed to write initial server-settings.json",
        e,
      ),
    );
    _cache = fresh;
    return fresh;
  }

  const merged: ServerSettings = {
    wizard: parsed.wizard === true,
    instanceId:
      typeof parsed.instanceId === "string" && parsed.instanceId.trim()
        ? parsed.instanceId
        : _defaults().instanceId,
    settings:
      parsed.settings &&
      typeof parsed.settings === "object" &&
      !Array.isArray(parsed.settings)
        ? (parsed.settings as Record<string, ServerSettingValue>)
        : {},
    ...(typeof parsed.corruptRecoveredAt === "string"
      ? { corruptRecoveredAt: parsed.corruptRecoveredAt }
      : {}),
  };
  if (!parsed.instanceId) {
    await _persist(merged).catch((err) =>
      logger.error(
        "server-settings",
        "failed to persist generated instanceId",
        err,
      ),
    );
  }
  _cache = merged;
  return merged;
};

export const writeServerSettings = async (
  patch: Partial<ServerSettings>,
): Promise<ServerSettings> => {
  const current = await readServerSettings();
  const next: ServerSettings = {
    wizard: typeof patch.wizard === "boolean" ? patch.wizard : current.wizard,
    instanceId:
      typeof patch.instanceId === "string" && patch.instanceId.trim()
        ? patch.instanceId
        : current.instanceId,
    settings:
      patch.settings &&
      typeof patch.settings === "object" &&
      !Array.isArray(patch.settings)
        ? patch.settings
        : current.settings,
    corruptRecoveredAt:
      "corruptRecoveredAt" in patch ? patch.corruptRecoveredAt : current.corruptRecoveredAt,
  };
  await _persist(next);
  _cache = next;
  await publishInvalidate(INVALIDATE_SCOPE.SERVER_SETTINGS);
  return next;
};

export const getInstanceSettings = async (): Promise<
  Record<string, SettingValue>
> => {
  const s = await readServerSettings();
  return (s.settings ?? {}) as Record<string, SettingValue>;
};

export const setInstanceSettings = async (
  next: Record<string, ServerSettingValue>,
): Promise<void> => {
  await writeServerSettings({ settings: next });
};

export const updateInstanceSettings = async (
  patch: Record<string, ServerSettingValue>,
): Promise<void> => {
  const current = (await readServerSettings()).settings ?? {};
  await setInstanceSettings({ ...current, ...patch });
};

export const getInstanceId = async (): Promise<string> => {
  const s = await readServerSettings();
  return s.instanceId;
};

export const didServerSettingsLoadFail = async (): Promise<boolean> =>
  !!(await readServerSettings()).corruptRecoveredAt;

export const acknowledgeServerSettingsRecovery = async (): Promise<void> => {
  if (!(await didServerSettingsLoadFail())) return;
  await writeServerSettings({ corruptRecoveredAt: undefined });
  logger.info("server-settings", "settings saved by an admin, search and autocomplete are open again");
};
