import { clear, render } from "../../../shared/ui/tribute/dom";
import type { ScoredResult } from "../../../shared/search-types";
import { cleanHostname, faviconHostname } from "../../../shared/utils/url";
import {
  attachFaviconFallback,
  hasFaviconProviders,
} from "../../utils/dom/favicon";
import { FaviconMissing } from "./favicon-missing";

const t = window.scopedT("themes/degoog");

export const setPreviewSource = (item: ScoredResult): void => {
  const domain = document.getElementById("media-preview-domain");
  if (domain) domain.textContent = cleanHostname(item.url);

  const favWrap = document.getElementById("media-preview-favicon-wrap");
  if (!favWrap) return;

  clear(favWrap);
  if (!hasFaviconProviders()) {
    render(
      <FaviconMissing tip={t("search-templates.result.favicon-missing")} />,
      favWrap,
    );
    return;
  }

  const favicon = document.createElement("img");
  favicon.className = "media-preview-favicon";
  favicon.alt = "";
  favicon.dataset.faviconHost = faviconHostname(item.url);
  if (item.favicon) favicon.src = item.favicon;
  favWrap.appendChild(favicon);
  attachFaviconFallback(favicon);
};
