import appPkg from "../../../package.json";

const _parseSemver = (v: string): [number, number, number] => {
  const clean = v.split("-")[0] ?? "";
  const parts = clean.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
};

export const getAppVersion = (): string => appPkg.version.split("-")[0] ?? "";

export const isVersionAtLeast = (current: string, required: string): boolean => {
  const [cMaj, cMin, cPatch] = _parseSemver(current);
  const [rMaj, rMin, rPatch] = _parseSemver(required);
  if (cMaj !== rMaj) return cMaj > rMaj;
  if (cMin !== rMin) return cMin > rMin;
  return cPatch >= rPatch;
};

const _parseDev = (v: string): number | null => {
  const idx = v.indexOf("-dev");
  if (idx === -1) return null;
  const tail = v.slice(idx + 4).replace(/^[-.]/, "");
  const n = parseFloat(tail);
  return Number.isFinite(n) ? n : 0;
};

const NUMERIC_ID = /^\d+$/;

const _sign = (n: number): number => (n === 0 ? 0 : n > 0 ? 1 : -1);

const _preRelease = (v: string): string[] => {
  const idx = v.indexOf("-");
  if (idx === -1) return [];
  const tail = v.slice(idx + 1).split("+")[0] ?? "";
  return tail ? tail.split(".") : [];
};

const _compareIdentifier = (a: string, b: string): number => {
  const aNum = NUMERIC_ID.test(a);
  const bNum = NUMERIC_ID.test(b);
  if (aNum && bNum) return _sign(Number(a) - Number(b));
  if (aNum) return -1;
  if (bNum) return 1;
  return a === b ? 0 : a > b ? 1 : -1;
};

const _comparePreRelease = (a: string, b: string): number => {
  const aIds = _preRelease(a);
  const bIds = _preRelease(b);
  if (aIds.length === 0 || bIds.length === 0) {
    return _sign(bIds.length - aIds.length);
  }
  for (let i = 0; i < Math.min(aIds.length, bIds.length); i++) {
    const diff = _compareIdentifier(aIds[i], bIds[i]);
    if (diff !== 0) return diff;
  }
  return _sign(aIds.length - bIds.length);
};

const _compareDev = (aDev: number | null, bDev: number | null): number => {
  if (aDev === null && bDev === null) return 0;
  if (aDev === null) return 1;
  if (bDev === null) return -1;
  return aDev === bDev ? 0 : aDev > bDev ? 1 : -1;
};

const compareVersions = (a: string, b: string): number => {
  const bSemver = _parseSemver(b);
  const base = _parseSemver(a).map((x, i) => x - bSemver[i]);
  const diff = base.find((d) => d !== 0);
  if (diff !== undefined) return diff > 0 ? 1 : -1;

  const aDev = _parseDev(a);
  const bDev = _parseDev(b);
  if (aDev !== null || bDev !== null) return _compareDev(aDev, bDev);
  return _comparePreRelease(a, b);
};

export const isUpdateAvailable = (current: string, newest: string): boolean =>
  compareVersions(newest, current) > 0;
