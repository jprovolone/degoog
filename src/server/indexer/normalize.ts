export const normalizeQuery = (query: string): string =>
  query.trim().toLowerCase().replace(/\s+/g, " ");
