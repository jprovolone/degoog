import { Button } from "../../../../shared/ui/components/primitives/button";
import type { Props } from "../../../../shared/ui/tribute/types";
import type { StoreItem } from "../../../types/store-tab";

const t = window.scopedT("core");

export const ItemCardActions = ({ item }: { item: StoreItem }): JSX.Element => {
  const dataAttrs: Props = {
    "data-repo-url": item.repoUrl,
    "data-item-path": item.path,
    "data-type": item.type,
  };
  const deleteAttrs: Props = item.untracked
    ? {
        "data-untracked": "true",
        "data-folder-name": item.path,
        "data-type": item.type,
      }
    : dataAttrs;

  if (item.orphaned) {
    return (
      <>
        <span class="ext-configured-badge"></span>
        <Button variant="danger" class="store-btn-delete" {...deleteAttrs}>
          Delete
        </Button>
      </>
    );
  }
  if (!item.installed) {
    return (
      <Button variant="primary" class="store-btn-install" {...dataAttrs}>
        {t("settings-page.store.install")}
      </Button>
    );
  }
  return (
    <>
      <span class="ext-configured-badge"></span>
      {item.updateAvailable ? (
        <Button variant="primary" class="store-btn-update" {...dataAttrs}>
          {t("settings-page.store.update")}
        </Button>
      ) : null}
      <Button variant="secondary" class="store-btn-uninstall" {...dataAttrs}>
        {t("settings-page.store.uninstall")}
      </Button>
    </>
  );
};
