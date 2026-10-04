import {
  BANG_CHIP_CLASS,
  BANG_CHIP_OFF_CLASS,
  bangChipTitle,
  bangLabel,
} from "./engine-bang";

export const EngineBangChip = ({
  engineId,
  shortcut,
  on,
  onClick,
}: {
  engineId: string;
  shortcut: string;
  on: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    class={on ? BANG_CHIP_CLASS : `${BANG_CHIP_CLASS} ${BANG_CHIP_OFF_CLASS}`}
    data-bang-id={engineId}
    data-bang={shortcut}
    aria-pressed={String(on)}
    data-tooltip={bangChipTitle(shortcut, on)}
    data-tooltip-start=""
    aria-label={bangChipTitle(shortcut, on)}
    onClick={onClick}
  >
    <span class="engine-bang-chip-text">{bangLabel(shortcut)}</span>
  </button>
);
