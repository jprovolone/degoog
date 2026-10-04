import { Desc } from "../../../../shared/ui/components/forms/desc";
import { IndexerNumberField } from "./indexer-number-field";
import { FIELDSET_INNER } from "../../server/render/classes";
import { tr } from "../i18n";

const FAVICON_STORE_MAX_AGE_MIN = 1;
const FAVICON_STORE_MAX_AGE_MAX = 3650;

export const FaviconStoreFieldset = (): JSX.Element => (
  <fieldset
    id="indexer-favicon-store-wrap"
    class={`${FIELDSET_INNER} degoog-indexer-stats`}
    hidden={true}
  >
    <p class="settings-rate-limit-defaults">{tr("favicon-store-heading")}</p>
    <Desc text={tr("favicon-store-desc")} />
    <IndexerNumberField
      name="favicon-store-max-age-days"
      min={FAVICON_STORE_MAX_AGE_MIN}
      max={FAVICON_STORE_MAX_AGE_MAX}
    />
  </fieldset>
);
