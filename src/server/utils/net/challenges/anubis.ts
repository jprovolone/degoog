import { createHash } from "node:crypto";
import type { TransportFetchOptions } from "../../../types/extension";
import { useCache } from "../../cache/cache";
import { logger } from "../../logger";
import { SentinelBreach, THREAT_LEVEL } from "../../security/sentinel";

const NS = "anubis";
const CHALLENGE_TAG = 'id="anubis_challenge"';
const CHALLENGE_RE = /<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/;
const BASE_PREFIX_RE = /<script id="anubis_base_prefix"[^>]*>([\s\S]*?)<\/script>/;
const PASS_PATH = "/.within.website/x/cmd/anubis/api/pass-challenge";
const DEFAULT_MAX_DIFFICULTY = 4;
const HARD_MAX_DIFFICULTY = 6;
const NONCE_HEADROOM = 8;
const HASHES_PER_SLICE = 4096;
const SOLVE_BUDGET_MS = 10_000;
const JAR_TTL_MS = 60 * 60 * 1000;
const COOKIE_SPLIT_RE = /,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/;
const STRIPPED_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];

export interface AnubisChallenge {
  id: string;
  data: string;
  difficulty: number;
  basePrefix: string;
}

export interface AnubisSolution {
  response: string;
  nonce: number;
  elapsedTime: number;
}

export type AnubisSend = (url: string, init: TransportFetchOptions) => Promise<Response>;

export interface AnubisPassOptions {
  jarKey: string;
  engine?: string;
  maxDifficulty?: number;
}

type Jar = Record<string, string>;

const _jars = useCache<Jar>("anubis-jar", JAR_TTL_MS);

export const anubisMaxDifficulty = (): number => {
  const parsed = parseInt(process.env.DEGOOG_ANUBIS_MAX_DIFFICULTY ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_DIFFICULTY;
  return Math.min(parsed, HARD_MAX_DIFFICULTY);
};

export const hasAnubisChallenge = (html: string): boolean => html.includes(CHALLENGE_TAG);

const _jsonScript = (re: RegExp, html: string): unknown => {
  const match = re.exec(html);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    logger.debug(NS, "challenge page carried an unreadable script", err);
    return undefined;
  }
};

const _field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

export const readAnubisChallenge = (html: string): AnubisChallenge | null => {
  const payload = _jsonScript(CHALLENGE_RE, html);
  const challenge = _field(payload, "challenge");
  const id = _field(challenge, "id");
  const data = _field(challenge, "randomData");
  const difficulty = _field(_field(payload, "rules"), "difficulty");
  if (typeof id !== "string" || !id) return null;
  if (typeof data !== "string" || !data) return null;
  if (typeof difficulty !== "number" || !Number.isInteger(difficulty) || difficulty < 1) return null;
  const prefix = _jsonScript(BASE_PREFIX_RE, html);
  return {
    id,
    data,
    difficulty,
    basePrefix: typeof prefix === "string" ? prefix.replace(/\/+$/, "") : "",
  };
};

const _zeroNibbles = (digest: Buffer, count: number): boolean => {
  for (let i = 0; i < count; i++) {
    const byte = digest[i >> 1];
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    if (nibble !== 0) return false;
  }
  return true;
};

const _yield = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export const solveAnubis = async (
  challenge: AnubisChallenge,
  opts: { signal?: AbortSignal; budgetMs?: number } = {},
): Promise<AnubisSolution | null> => {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? SOLVE_BUDGET_MS);
  const ceiling = 16 ** challenge.difficulty * NONCE_HEADROOM;
  for (let nonce = 0; nonce <= ceiling; nonce++) {
    if (nonce > 0 && nonce % HASHES_PER_SLICE === 0) {
      if (opts.signal?.aborted || Date.now() > deadline) return null;
      await _yield();
    }
    const digest = createHash("sha256").update(`${challenge.data}${nonce}`).digest();
    if (!_zeroNibbles(digest, challenge.difficulty)) continue;
    return {
      response: digest.toString("hex"),
      nonce,
      elapsedTime: Math.max(1, Date.now() - started),
    };
  }
  return null;
};

const _setCookieLines = (res: Response): string[] => {
  const listed = res.headers.getSetCookie();
  if (listed.length) return listed;
  const joined = res.headers.get("set-cookie");
  return joined ? joined.split(COOKIE_SPLIT_RE) : [];
};

const _absorb = (jar: Jar, res: Response, knownOnly: boolean): void => {
  for (const line of _setCookieLines(res)) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (knownOnly && !(name in jar)) continue;
    if (value) jar[name] = value;
    else delete jar[name];
  }
};

const _cookieHeader = (headers: Record<string, string>): string =>
  headers.Cookie ?? headers.cookie ?? "";

const _withJar = (init: TransportFetchOptions, jar: Jar): TransportFetchOptions => {
  const names = Object.keys(jar);
  if (names.length === 0) return init;
  const headers = { ...(init.headers ?? {}) };
  const theirs = _cookieHeader(headers)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !names.includes(part.split("=")[0].trim()));
  delete headers.cookie;
  const ours = names.map((name) => `${name}=${jar[name]}`);
  headers.Cookie = [...theirs, ...ours].join("; ");
  return { ...init, headers };
};

const _rebuild = (res: Response, body: string): Response => {
  const headers = new Headers(res.headers);
  for (const name of STRIPPED_HEADERS) headers.delete(name);
  const rebuilt = new Response(body, { status: res.status, statusText: res.statusText, headers });
  if (res.url) Object.defineProperty(rebuilt, "url", { value: res.url });
  return rebuilt;
};

const _gate = (message: string, engine?: string): SentinelBreach =>
  new SentinelBreach(THREAT_LEVEL.INTERSTITIAL, message, { engine });

const _discard = async (res: Response): Promise<void> => {
  try {
    await res.body?.cancel();
  } catch (err) {
    logger.debug(NS, "could not discard the pass-challenge body", err);
  }
};

export const fetchPastAnubis = async (
  send: AnubisSend,
  url: string,
  init: TransportFetchOptions,
  opts: AnubisPassOptions,
): Promise<Response> => {
  const origin = new URL(url).origin;
  const who = opts.engine ?? origin;
  const key = createHash("sha256").update(`${opts.jarKey}|${origin}`).digest("hex");
  const jar: Jar = { ...((await _jars.get(key)) ?? {}) };

  const first = await send(url, _withJar(init, jar));
  _absorb(jar, first, true);
  const html = await first.text();
  if (!hasAnubisChallenge(html)) {
    await _jars.set(key, jar);
    return _rebuild(first, html);
  }

  const challenge = readAnubisChallenge(html);
  if (!challenge) throw _gate(`${who} served an Anubis challenge that could not be read`, opts.engine);
  const max = opts.maxDifficulty ?? anubisMaxDifficulty();
  if (challenge.difficulty > max) {
    throw _gate(
      `${who} raised its Anubis difficulty to ${challenge.difficulty}, above the limit of ${max}`,
      opts.engine,
    );
  }
  _absorb(jar, first, false);

  const solved = await solveAnubis(challenge, { signal: init.signal });
  if (!solved) {
    throw _gate(`${who} served an Anubis challenge that could not be solved in time`, opts.engine);
  }
  logger.debug(NS, `solved ${origin} at difficulty ${challenge.difficulty} in ${solved.elapsedTime}ms`);

  const params = new URLSearchParams({
    id: challenge.id,
    response: solved.response,
    nonce: String(solved.nonce),
    redir: url,
    elapsedTime: String(solved.elapsedTime),
  });
  const pass = await send(
    `${origin}${challenge.basePrefix}${PASS_PATH}?${params.toString()}`,
    _withJar(
      {
        method: "GET",
        redirect: "manual",
        signal: init.signal,
        headers: { ...(init.headers ?? {}), Referer: url },
      },
      jar,
    ),
  );
  _absorb(jar, pass, false);
  await _discard(pass);

  const retry = await send(url, _withJar(init, jar));
  _absorb(jar, retry, true);
  const retryHtml = await retry.text();
  if (hasAnubisChallenge(retryHtml)) {
    await _jars.delete(key);
    throw _gate(
      `${who} served the Anubis challenge again after it was solved, so the transport is probably dropping its cookies`,
      opts.engine,
    );
  }
  await _jars.set(key, jar);
  return _rebuild(retry, retryHtml);
};
