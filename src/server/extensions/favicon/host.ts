const FAVICON_HOST_RE = /^[a-zA-Z0-9.-]+$/;
const MAX_HOST_LENGTH = 253;

export const isFaviconHost = (raw: string): boolean =>
  raw.length > 0 && raw.length <= MAX_HOST_LENGTH && FAVICON_HOST_RE.test(raw);

export const normalizeFaviconHost = (raw: string | undefined | null): string => {
  const host = (raw ?? "").trim().toLowerCase();
  return isFaviconHost(host) ? host : "";
};
