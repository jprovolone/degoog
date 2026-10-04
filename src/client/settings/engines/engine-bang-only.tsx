import { bangLabel } from "./engine-bang";

const t = window.scopedT("core");

export const EngineBangOnly = ({
  engineId,
  shortcut,
  visible,
}: {
  engineId: string;
  shortcut: string;
  visible: boolean;
}): JSX.Element => (
  <p class="engine-bang-only" data-bang-only={engineId} hidden={!visible}>
    {t("settings-page.extensions.bang-only", { bang: bangLabel(shortcut) })}
  </p>
);
