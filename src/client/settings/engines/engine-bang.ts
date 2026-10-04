const t = window.scopedT("core");

export const BANG_CHIP_CLASS = "engine-bang-chip";
export const BANG_CHIP_OFF_CLASS = "engine-bang-chip--off";
const BANG_CHIP_PULSE_CLASS = "engine-bang-chip--pulse";

export const bangLabel = (shortcut: string): string => `!${shortcut}`;

export const bangChipTitle = (shortcut: string, on: boolean): string =>
  t(
    on
      ? "settings-page.extensions.bang-on-title"
      : "settings-page.extensions.bang-off-title",
    { bang: bangLabel(shortcut) },
  );

export const paintEngineBang = (
  root: HTMLElement,
  engineId: string,
  engineOn: boolean,
  bangOn: boolean,
  pulse = false,
): void => {
  const id = CSS.escape(engineId);
  const chip = root.querySelector<HTMLButtonElement>(`[data-bang-id="${id}"]`);
  const only = root.querySelector<HTMLElement>(`[data-bang-only="${id}"]`);
  if (only) only.hidden = !(bangOn && !engineOn);
  if (!chip) return;
  chip.classList.toggle(BANG_CHIP_OFF_CLASS, !bangOn);
  chip.setAttribute("aria-pressed", String(bangOn));
  const tip = bangChipTitle(chip.dataset.bang ?? "", bangOn);
  chip.dataset.tooltip = tip;
  chip.setAttribute("aria-label", tip);
  if (!pulse) return;
  chip.classList.remove(BANG_CHIP_PULSE_CLASS);
  void chip.offsetWidth;
  chip.classList.add(BANG_CHIP_PULSE_CLASS);
  chip.addEventListener(
    "animationend",
    () => chip.classList.remove(BANG_CHIP_PULSE_CLASS),
    { once: true },
  );
};
