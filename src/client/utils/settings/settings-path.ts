import {
  SETTINGS_TABS,
  type SettingsTab,
} from "../../../shared/settings-tabs";

export function getSettingsRoot(): string {
  const path = window.location.pathname.replace(/\/$/, "");
  for (const tab of SETTINGS_TABS) {
    if (path.endsWith(`/${tab}`)) {
      return path.slice(0, -(tab.length + 1));
    }
  }
  return path;
}

export function getActiveSettingsTab(): SettingsTab | null {
  const root = getSettingsRoot();
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === root) return "general";
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return null;
  const segment = path.slice(prefix.length);
  if (segment.includes("/")) return null;
  if (!(SETTINGS_TABS as readonly string[]).includes(segment)) return null;
  return segment as SettingsTab;
}

export function isSettingsPathname(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, "");
  if (normalized === "/settings" || normalized.startsWith("/settings/")) {
    return true;
  }
  for (const tab of SETTINGS_TABS) {
    if (normalized.endsWith(`/${tab}`)) return true;
  }
  const root = getSettingsRoot();
  return normalized === root || normalized.startsWith(`${root}/`);
}

export function switchSettingsTab(value: string, updateUrl = true): void {
  document
    .querySelectorAll<HTMLElement>(".settings-tab-panel")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById(`tab-${value}`)?.classList.add("active");
  document.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === value);
  });
  const select = document.getElementById(
    "settings-tab-select",
  ) as HTMLSelectElement | null;
  if (select) select.value = value;

  if (updateUrl) {
    const root = getSettingsRoot();
    const path = value === "general" ? root : `${root}/${value}`;
    window.history.replaceState({}, "", path);
  }

  window.dispatchEvent(
    new CustomEvent("settings-tab-changed", { detail: value }),
  );
}
