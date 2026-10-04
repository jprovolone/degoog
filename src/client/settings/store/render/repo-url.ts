import { getBase } from "../../../utils/net/base-url";
import type { RepoInfo } from "../../../types/store-tab";

const t = window.scopedT("core");

export function normalizeRepoUrl(url: string): string {
  const normUrl = (url || "").trim();
  return normUrl.endsWith(".git")
    ? normUrl
    : normUrl + (normUrl.includes("?") || normUrl.includes("#") ? "" : ".git");
}

export function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return t("settings-page.store.time-just-now");
    if (s < 3600)
      return t("settings-page.store.time-min-ago", {
        n: String(Math.floor(s / 60)),
      });
    if (s < 86400)
      return t("settings-page.store.time-hours-ago", {
        n: String(Math.floor(s / 3600)),
      });
    return t("settings-page.store.time-days-ago", {
      n: String(Math.floor(s / 86400)),
    });
  } catch {
    return "";
  }
}

export function repoImageSrc(repo: RepoInfo): string {
  const img = repo.repoImage;
  if (!img) return "";
  if (img.startsWith(`${getBase()}/api/proxy/`)) return img;
  if (/^[a-z][a-z0-9+.-]*:/i.test(img) || img.startsWith("//")) return "";
  return `${getBase()}/api/store/repos/${encodeURIComponent(repo.localPath)}/asset?path=${encodeURIComponent(img)}`;
}
