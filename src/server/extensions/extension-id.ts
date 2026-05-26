import { createHash } from "crypto";

export type ExtensionKind =
  | "slot"
  | "middleware"
  | "tab"
  | "transport"
  | "command"
  | "engine"
  | "theme"
  | "autocomplete"
  | "uovadipasqua";

const _shortHash = (input: string): string =>
  createHash("sha256").update(input).digest("hex").slice(0, 8);

export const makeExtID = (
  folderName: string,
  kind: ExtensionKind,
): string => {
  const suffix = `-${kind}`;
  return folderName.endsWith(suffix) ? folderName : `${folderName}${suffix}`;
};

export const folderFromExtID = (id: string, kind: ExtensionKind): string => {
  const suffix = `-${kind}`;
  return id.endsWith(suffix) ? id.slice(0, -suffix.length) : id;
};

export const dedupeExtID = (
  desired: string,
  existing: Set<string>,
  entryPath: string,
): string => {
  if (!existing.has(desired)) return desired;
  const withHash = `${desired}-${_shortHash(entryPath)}`;
  if (!existing.has(withHash)) return withHash;
  return `${withHash}-${_shortHash(withHash)}`;
};
