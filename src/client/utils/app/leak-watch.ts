const LEAK_REPORT_URL = "https://github.com/degoog-org/degoog/issues";
const ENFORCED = "enforce";

type LeakEntry = {
  url: string;
  directive: string;
  source?: string;
  disposition?: string;
};

type LeakWindow = Window & {
  __DEGOOG_LEAKS__?: { push: (entry: LeakEntry) => void } | LeakEntry[];
};

const t = window.scopedT("core");
const _warned = new Set<string>();

const _thirdPartyUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:")
      return null;
    return url.host === window.location.host ? null : url;
  } catch (err) {
    console.debug("[leak-watch] unparseable url", err);
    return null;
  }
};

const _kind = (directive: string): string => {
  const key = `leak-guard.kind-${directive}`;
  const label = t(key);
  return label === key ? t("leak-guard.kind-default-src") : label;
};

const _source = (source: string | undefined): string => {
  if (!source) return t("leak-guard.from-page");
  try {
    const url = new URL(source, window.location.href);
    if (url.href.split("#")[0] === window.location.href.split("#")[0])
      return t("leak-guard.from-page");
    return t("leak-guard.from", {
      source: url.host === window.location.host ? url.pathname : url.href,
    });
  } catch (err) {
    console.debug("[leak-watch] unparseable source", err);
    return t("leak-guard.from-page");
  }
};

const WEBRTC_DIRECTIVE = "webrtc";

const _target = (entry: LeakEntry): { shown: string; host: string } | null => {
  if (entry.directive === WEBRTC_DIRECTIVE) {
    const servers = entry.url.replace(/^webrtc:$/, "");
    return { shown: servers || t("leak-guard.webrtc-no-servers"), host: servers || "WebRTC" };
  }
  const url = _thirdPartyUrl(entry.url);
  return url ? { shown: `${url.origin}${url.pathname}`, host: url.host } : null;
};

async function _handle(entry: LeakEntry): Promise<void> {
  const target = _target(entry);
  if (!target) return;
  const { shown, host } = target;
  const kind = _kind(entry.directive);
  const blocked = entry.disposition === ENFORCED;
  if (!_warned.has(`${blocked}|${shown}`)) {
    _warned.add(`${blocked}|${shown}`);
    console.warn(
      t(blocked ? "leak-guard.console-blocked" : "leak-guard.console-reported", {
        url: shown,
        kind,
        host,
        reportUrl: LEAK_REPORT_URL,
      }),
    );
  }
  if (!blocked) return;
  const { showBlockedLeak } = await import("../../modules/modals/leak-modal/leak-modal");
  showBlockedLeak({ kind, host, url: shown, from: _source(entry.source) });
}

export function initLeakWatch(): void {
  const w = window as LeakWindow;
  const buffered = Array.isArray(w.__DEGOOG_LEAKS__) ? w.__DEGOOG_LEAKS__ : null;
  const push = (entry: LeakEntry): void => void _handle(entry);
  w.__DEGOOG_LEAKS__ = { push };
  if (!buffered) {
    document.addEventListener("securitypolicyviolation", (e) =>
      push({
        url: e.blockedURI,
        directive: e.effectiveDirective || e.violatedDirective,
        source: e.sourceFile,
        disposition: e.disposition,
      }),
    );
  }
  for (const entry of buffered ?? []) push(entry);
}
