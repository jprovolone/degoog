import { buttonClass } from "../../../shared/ui/components/primitives/button";
import { linkHref } from "../../../shared/utils/url";

const t = window.scopedT("themes/degoog");

export const MediaPreviewActions = ({
  url,
  newTab,
  isVideo,
  downloadUrl,
  downloadFilename,
}: {
  url: string;
  newTab: boolean;
  isVideo: boolean;
  downloadUrl?: string;
  downloadFilename?: string;
}): JSX.Element => (
  <>
    <a
      class={buttonClass("primary", "media-preview-visit")}
      href={linkHref(url)}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener" : undefined}
    >
      {isVideo ? t("search-templates.media-preview.watch") : t("search-templates.media-preview.visit")}
    </a>
    {!isVideo && downloadUrl ? (
      <a
        class={buttonClass("secondary", "media-preview-download")}
        href={downloadUrl}
        download={downloadFilename}
      >
        {t("search-templates.media-preview.download")}
      </a>
    ) : null}
  </>
);
