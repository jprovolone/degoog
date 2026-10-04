import { getBase } from "../net/base-url";

const SETTINGS_RETURN_KEY = "degoog-settings-return";

export function recordSettingsReturn(): void {
  if (window.location.pathname !== "/search") return;
  sessionStorage.setItem(
    SETTINGS_RETURN_KEY,
    `${window.location.pathname}${window.location.search}`,
  );
}

export function clearSettingsReturn(): void {
  sessionStorage.removeItem(SETTINGS_RETURN_KEY);
}

export function navigateSettingsBack(): void {
  const raw = sessionStorage.getItem(SETTINGS_RETURN_KEY);
  sessionStorage.removeItem(SETTINGS_RETURN_KEY);
  if (!raw) {
    window.location.href = `${getBase()}/`;
    return;
  }
  try {
    const parsed = new URL(raw, window.location.origin);
    if (
      parsed.origin !== window.location.origin ||
      parsed.pathname !== "/search"
    ) {
      window.location.href = `${getBase()}/`;
      return;
    }
    if (!parsed.search && !parsed.hash) {
      window.history.back();
      return;
    }
    window.location.href = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    window.location.href = `${getBase()}/`;
  }
}

export function showHome(): void {
  clearSettingsReturn();
  window.location.href = `${getBase()}/`;
}

let _bangMatchTypes: string[] | undefined = undefined;

export const isBangTabVisible = (tabType: string): boolean | undefined =>
  _bangMatchTypes?.some(
    (t) => tabType === t || tabType === `tab:engine:${t}`,
  );

export function setActiveTab(type: string): void {
  document.querySelectorAll<HTMLElement>(".results-tab").forEach((tab) => {
    const tabType = tab.dataset.type ?? "";
    const match = tabType === type || tabType === `tab:engine:${type}`;
    tab.classList.toggle("active", match);
  });
}

function _updateTabVisibility(tab: HTMLElement): void {
  tab.style.display = tab.dataset.bangHidden === "true" ? "none" : "";
}

export function setTabsForBang(matchTypes: string[]): void {
  _bangMatchTypes = matchTypes;
  document.querySelectorAll<HTMLElement>(".results-tab").forEach((tab) => {
    const visible = isBangTabVisible(tab.dataset.type ?? "") === true;
    tab.dataset.bangHidden = visible ? "" : "true";
    _updateTabVisibility(tab);
  });
}

export function showAllTabs(): void {
  _bangMatchTypes = undefined;
  document.querySelectorAll<HTMLElement>(".results-tab").forEach((tab) => {
    delete tab.dataset.bangHidden;
    _updateTabVisibility(tab);
  });
}
