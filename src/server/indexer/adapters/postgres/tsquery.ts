import { canPrefix, splitTerms } from "../../shared/terms";

const quoteLexeme = (token: string): string =>
  `'${token.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

export const buildTsQuery = (queryNorm: string): string =>
  splitTerms(queryNorm)
    .map((t) => (canPrefix(t) ? `${quoteLexeme(t.token)}:*` : quoteLexeme(t.token)))
    .join(" & ");
