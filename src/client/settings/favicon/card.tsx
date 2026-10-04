import { raw } from "../../../shared/ui/tribute/rawdogit";
import { DragHandle } from "../../../shared/ui/components/extensions/drag-handle";
import { ExtCard } from "../../../shared/ui/components/extensions/ext-card";
import { ExtCardDesc } from "../../../shared/ui/components/extensions/ext-card-desc";
import { ExtCardName } from "../../../shared/ui/components/extensions/ext-card-name";
import { ExtToggle } from "../../../shared/ui/components/extensions/ext-toggle";
import {
  extCardBadgeNode,
  extCardConfigureNode,
  extCardRestartWarningNode,
  extCardVersionWarningNode,
} from "../shared/ext-card";
import { extToggleHandler } from "../shared/ext-toggle";
import { openModal } from "../../modules/modals/settings-modal/modal";
import type { ExtensionMeta } from "../../types/extension";
import { renderMdInline } from "../../utils/dom/md";

const t = window.scopedT("core");

export const FaviconCard = ({ provider }: { provider: ExtensionMeta }): JSX.Element => {
  const isEnabled = provider.settings["disabled"] !== "true";
  const toggleId = `favicon-toggle-${provider.id}`;

  return (
    <ExtCard
      id={provider.id}
      nameRow={[
        extCardRestartWarningNode(provider),
        <ExtCardName
          htmlFor={toggleId}
          class="favicon-toggle-label"
          name={provider.displayName}
        />,
      ]}
      info={[
        provider.description ? (
          <ExtCardDesc html={raw(renderMdInline(provider.description))} />
        ) : null,
        extCardVersionWarningNode(provider),
      ]}
      actions={[
        extCardBadgeNode(provider),
        extCardConfigureNode(provider, () => openModal(provider)),
        <ExtToggle
          id={toggleId}
          inputClass="favicon-toggle-input"
          dataId={provider.id}
          checked={isEnabled}
          onChange={extToggleHandler(provider.id, isEnabled, "favicon")}
        />,
        <DragHandle label={t("settings-page.extensions.drag-to-reorder")} />,
      ]}
    />
  );
};
