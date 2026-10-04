import { raw } from "../../../../shared/ui/tribute/rawdogit";

const t = window.scopedT("core");

export const Lightbox = (): JSX.Element => (
  <div
    class="store-lightbox"
    id="store-lightbox"
    aria-hidden="true"
    role="dialog"
    aria-modal="true"
    aria-label={t("settings-page.store.lightbox-aria")}
  >
    <div class="store-lightbox-backdrop"></div>
    <button
      class="store-lightbox-close"
      type="button"
      aria-label={t("settings-page.store.close-aria")}
    >
      {raw("&times;")}
    </button>
    <button
      class="store-lightbox-prev"
      type="button"
      aria-label={t("settings-page.store.prev-aria")}
    >
      {raw("&larr;")}
    </button>
    <div class="store-lightbox-img-wrap">
      <img class="store-lightbox-img" src="" alt="" />
    </div>
    <button
      class="store-lightbox-next"
      type="button"
      aria-label={t("settings-page.store.next-aria")}
    >
      {raw("&rarr;")}
    </button>
    <div class="store-lightbox-counter"></div>
  </div>
);
