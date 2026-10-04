import { FAVICON_SHAPE_VALUES } from "../../../shared/favicon-shapes";
import { getBase } from "../../utils/net/base-url";

const t = window.scopedT("core");

const LOGO_PATH = "/public/images/degoog-logo.png";

export const ShapePicker = ({ active }: { active: string }): JSX.Element => (
  <div class="ext-group favicon-shape-picker">
    <h3 class="ext-group-label">{t("settings-page.extensions.favicon-shape-label")}</h3>
    <div
      class="favicon-shape-options"
      role="radiogroup"
      aria-label={t("settings-page.extensions.favicon-shape-label")}
    >
      {FAVICON_SHAPE_VALUES.map((shape) => (
        <button
          key={shape}
          type="button"
          role="radio"
          aria-checked={shape === active ? "true" : "false"}
          class={`favicon-shape-option favicon-shape--${shape}${shape === active ? " is-active" : ""}`}
          data-favicon-shape-option={shape}
          data-tooltip={t(`settings-page.extensions.favicon-shape-${shape}`)}
          data-tooltip-below={true}
          aria-label={t(`settings-page.extensions.favicon-shape-${shape}`)}
        >
          <img class="favicon-shape-tile" src={`${getBase()}${LOGO_PATH}`} alt="" />
        </button>
      ))}
    </div>
    <p class="favicon-shape-note">{t("settings-page.extensions.favicon-shape-note")}</p>
  </div>
);
