declare global {
  interface Window {
    __DEGOOG_FAVICONS__?: { providers?: boolean };
  }
}

const FALLBACK_CLASS = "result-favicon-fallback";
const HIRES_CLASS = "favicon-hires";
const HIRES_MIN_PX = 32;

export const hasFaviconProviders = (): boolean =>
  window.__DEGOOG_FAVICONS__?.providers !== false;

const _faviconLetter = (el: HTMLElement): string => {
  const own = el.dataset.faviconLetter;
  if (own) return own[0]!.toUpperCase();
  const hostname = el.dataset.faviconHost ?? "";
  return (hostname.replace(/^www\./, "")[0] ?? "?").toUpperCase();
};

const _replaceWithLetterFallback = (img: HTMLImageElement): void => {
  const span = document.createElement("span");
  span.className = `${img.className} ${FALLBACK_CLASS}`.trim();
  if (img.id) span.id = img.id;
  span.setAttribute("aria-hidden", "true");
  if (img.dataset.faviconHost) span.dataset.faviconHost = img.dataset.faviconHost;
  if (img.dataset.faviconLetter) span.dataset.faviconLetter = img.dataset.faviconLetter;
  span.textContent = _faviconLetter(img);
  img.replaceWith(span);
};

function _markResolution(img: HTMLImageElement): void {
  const apply = (): void => {
    img.classList.toggle(HIRES_CLASS, img.naturalWidth >= HIRES_MIN_PX);
  };
  img.classList.remove(HIRES_CLASS);
  if (img.complete && img.naturalWidth > 0) apply();
  else img.addEventListener("load", apply, { once: true });
}

export const attachFaviconFallback = (img: HTMLImageElement): void => {
  if (!img.getAttribute("src")) {
    _replaceWithLetterFallback(img);
    return;
  }
  _markResolution(img);
  img.onerror = () => {
    img.onerror = null;
    _replaceWithLetterFallback(img);
  };
};

const _imageFromFallback = (span: HTMLElement): HTMLImageElement => {
  const img = document.createElement("img");
  img.className = span.className
    .split(/\s+/)
    .filter((name) => name && name !== FALLBACK_CLASS)
    .join(" ");
  if (span.id) img.id = span.id;
  img.alt = "";
  img.loading = "lazy";
  img.width = 26;
  img.height = 26;
  if (span.dataset.faviconLetter) img.dataset.faviconLetter = span.dataset.faviconLetter;
  span.replaceWith(img);
  return img;
};

export const swapFavicon = (el: HTMLElement, host: string, src: string): void => {
  const img =
    el instanceof HTMLImageElement
      ? el
      : src
        ? _imageFromFallback(el)
        : null;
  if (!img) {
    el.dataset.faviconHost = host;
    el.textContent = _faviconLetter(el);
    return;
  }
  img.dataset.faviconHost = host;
  if (src) img.src = src;
  else img.removeAttribute("src");
  attachFaviconFallback(img);
};
