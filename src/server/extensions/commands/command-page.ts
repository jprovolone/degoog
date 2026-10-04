export const MAX_COMMAND_PAGE = 10;

export const clampCommandPage = (raw: unknown): number =>
  Math.max(1, Math.min(MAX_COMMAND_PAGE, Math.floor(Number(raw)) || 1));
