import { ExtCard } from "../../../shared/ui/components/extensions/ext-card";
import { ExtCardDesc } from "../../../shared/ui/components/extensions/ext-card-desc";
import { ExtCardName } from "../../../shared/ui/components/extensions/ext-card-name";
import { ExtToggle } from "../../../shared/ui/components/extensions/ext-toggle";
import { saveField } from "../../utils/settings/settings-api";
import { getStoredToken } from "../../utils/settings/settings-token";
import { flashError, flashSuccess } from "../shared/flash-msg";

const t = window.scopedT("core");

export const FAVICON_STORE_SETTING = "degoogFaviconStoreEnabled";

const DEGOOG_CARD_ID = "degoog-favicon";
const TOGGLE_ID = "favicon-toggle-degoog";

const _onToggle = (event: Event): void => {
  const input = event.currentTarget as HTMLInputElement;
  const intended = input.checked;
  void saveField(FAVICON_STORE_SETTING, String(intended), getStoredToken).then((ok) => {
    if (ok) {
      flashSuccess(t("settings-page.server.saved"));
      return;
    }
    input.checked = !intended;
    flashError(t("settings-page.server.save-failed-network"));
  });
};

export const DegoogFaviconCard = ({ enabled }: { enabled: boolean }): JSX.Element => (
  <ExtCard
    id={DEGOOG_CARD_ID}
    nameRow={[
      <ExtCardName
        htmlFor={TOGGLE_ID}
        class="favicon-toggle-label"
        name={t("settings-page.extensions.favicon-degoog-name")}
      />,
    ]}
    info={[<ExtCardDesc html={t("settings-page.extensions.favicon-degoog-desc")} />]}
    actions={[
      <ExtToggle
        id={TOGGLE_ID}
        inputClass="favicon-toggle-input"
        dataId={DEGOOG_CARD_ID}
        checked={enabled}
        onChange={_onToggle}
      />,
    ]}
  />
);
