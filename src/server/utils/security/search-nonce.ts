import { randomBytes } from "crypto";
import { signData, verifyData } from "./server-key";

const NONCE_TTL_MS = 60 * 60 * 1000;
const NONCE_CLOCK_SKEW_MS = 60 * 1000;
const NONCE_SIGN_PREFIX = "nonce:";
const NONCE_RE = /^[0-9a-f]{44}$/;

const _signNonce = (n: string): string => signData(`${NONCE_SIGN_PREFIX}${n}`);

export const generateSearchNonce = (): { n: string; s: string } => {
  const ts = Date.now().toString(16).padStart(12, "0");
  const rand = randomBytes(16).toString("hex");
  const n = ts + rand;
  return { n, s: _signNonce(n) };
};

export const verifySearchNonce = (n: string, s: string): boolean => {
  if (!NONCE_RE.test(n)) return false;
  if (!verifyData(`${NONCE_SIGN_PREFIX}${n}`, s)) return false;
  const age = Date.now() - parseInt(n.slice(0, 12), 16);
  return age >= -NONCE_CLOCK_SKEW_MS && age < NONCE_TTL_MS;
};
