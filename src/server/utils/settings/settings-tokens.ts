import { readFile } from "fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { logger } from "../logger";
import { settingsTokensFile } from "../paths";
import { writeJsonAtomic } from "../storage/atomic-json";

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const PASSWORDS_FINGERPRINT_KEY = "__passwords";

const _validTokens = new Map<string, number>();
let _passwordsFingerprint: string | null = null;

export const explicitSettingsPasswords = (): string[] =>
  (process.env.DEGOOG_SETTINGS_PASSWORDS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

const _hashPasswords = (salt: string): string =>
  scryptSync([...explicitSettingsPasswords()].sort().join("\n"), salt, 32).toString("hex");

const _freshFingerprint = (): string => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${_hashPasswords(salt)}`;
};

const _fingerprintMatches = (stored: string): boolean => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return _safeEqual(_hashPasswords(salt), hash);
};

const _currentFingerprint = (): string =>
  (_passwordsFingerprint ??= _freshFingerprint());

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _persisting = false;

const _persistNow = async (): Promise<void> => {
  if (_persisting) {
    if (!_persistTimer) schedulePersist();
    return;
  }
  _persisting = true;
  try {
    await writeJsonAtomic(settingsTokensFile(), {
      [PASSWORDS_FINGERPRINT_KEY]: _currentFingerprint(),
      ...Object.fromEntries(_validTokens),
    });
  } catch (e) {
    logger.warn(
      "settings-auth",
      `failed to persist tokens: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    _persisting = false;
  }
};

const schedulePersist = (): void => {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    void _persistNow();
  }, 200);
};

const _loadPersistedTokens = async (): Promise<void> => {
  try {
    const raw = await readFile(settingsTokensFile(), "utf-8");
    const data = JSON.parse(raw) as Record<string, number | string>;
    const stored = data[PASSWORDS_FINGERPRINT_KEY];
    if (typeof stored === "string" && !_fingerprintMatches(stored)) {
      logger.info("settings-auth", "settings passwords changed since the last run, signing everybody out");
      schedulePersist();
      return;
    }
    if (typeof stored === "string") _passwordsFingerprint = stored;
    else schedulePersist();
    const now = Date.now();
    let loaded = 0;
    for (const [token, expiresAt] of Object.entries(data)) {
      if (token === PASSWORDS_FINGERPRINT_KEY) continue;
      if (typeof expiresAt === "number" && expiresAt > now) {
        _validTokens.set(token, expiresAt);
        loaded++;
      }
    }
    if (loaded > 0) {
      logger.debug("settings-auth", `restored ${loaded} persisted token(s)`);
    }
  } catch (err) {
    logger.debug("settings-auth", "no persisted tokens to restore", err);
  }
};

void _loadPersistedTokens();

export const tokenStore = {
  get: (token: string): number | undefined => _validTokens.get(token),
  set: (token: string, expiresAt: number): void => {
    _validTokens.set(token, expiresAt);
    schedulePersist();
  },
  delete: (token: string): void => {
    if (_validTokens.delete(token)) schedulePersist();
  },
  size: (): number => _validTokens.size,
  pruneExpired: (): void => {
    const now = Date.now();
    let pruned = 0;
    for (const [token, expiresAt] of _validTokens) {
      if (now > expiresAt) {
        _validTokens.delete(token);
        pruned++;
      }
    }
    if (pruned > 0) schedulePersist();
  },
};

export const generateSettingsToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const _safeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
};

export const passwordMatches = (
  candidate: string,
  allowed: string[],
): boolean => {
  let matched = false;
  for (const p of allowed) {
    if (_safeEqual(candidate, p)) matched = true;
  }
  return matched;
};

const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX_FAILURES = 10;
const _authAttempts = new Map<string, number[]>();

export const checkAuthRate = (
  ip: string,
): { allowed: boolean; retryAfter: number } => {
  const now = Date.now();
  const cutoff = now - AUTH_RATE_WINDOW_MS;
  const attempts = (_authAttempts.get(ip) ?? []).filter((t) => t >= cutoff);
  if (attempts.length === 0) _authAttempts.delete(ip);
  else _authAttempts.set(ip, attempts);
  if (attempts.length >= AUTH_RATE_MAX_FAILURES) {
    const retryAfter = Math.ceil(
      (attempts[0] + AUTH_RATE_WINDOW_MS - now) / 1000,
    );
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }
  return { allowed: true, retryAfter: 0 };
};

export const recordAuthFailure = (ip: string): void => {
  const now = Date.now();
  const cutoff = now - AUTH_RATE_WINDOW_MS;
  const attempts = (_authAttempts.get(ip) ?? []).filter((t) => t >= cutoff);
  attempts.push(now);
  _authAttempts.set(ip, attempts);
};

export const forgiveAuthAttempt = (ip: string): void => {
  const attempts = _authAttempts.get(ip);
  if (!attempts) return;
  attempts.pop();
  if (attempts.length === 0) _authAttempts.delete(ip);
};
