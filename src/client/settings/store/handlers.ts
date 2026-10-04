import type { RepoInfo } from "../../types/store-tab";
import { jsonHeaders } from "../../utils/net/request";
import { confirmModal } from "../../modules/modals/confirm-modal/confirm";
import { getBase } from "../../utils/net/base-url";
import {
  setItemPhase,
  setRepoPhase,
  streamRefreshAll,
  streamUpdateAll,
} from "./overlays/progress";
import { maybeShowRestartNotice } from "./overlays/restart-notice";

const t = window.scopedT("core");

export function showError(el: HTMLElement | null, msg: string): void {
  if (!el) return;
  el.textContent = msg;
  el.classList.add("store-error-visible");
  setTimeout(() => el.classList.remove("store-error-visible"), 4000);
}

export async function handleAddRepo(
  inputEl: HTMLInputElement | null,
  addBtn: HTMLButtonElement,
  errorEl: HTMLElement | null,
  getToken: () => string | null,
  refreshAndRender: () => Promise<void>,
): Promise<void> {
  const url = inputEl?.value?.trim();
  if (!url) return;
  addBtn.disabled = true;
  if (errorEl) errorEl.textContent = "";
  try {
    const res = await fetch(`${getBase()}/api/store/repos`, {
      method: "POST",
      headers: jsonHeaders(getToken),
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      showError(
        errorEl,
        data.error || t("settings-page.store.failed-add-repo"),
      );
      return;
    }
    if (inputEl) inputEl.value = "";
    await refreshAndRender();
  } catch {
    showError(errorEl, t("settings-page.store.network-error"));
  } finally {
    addBtn.disabled = false;
  }
}

export async function handleRefresh(
  container: HTMLElement,
  url: string,
  getToken: () => string | null,
  refreshAndRender: () => Promise<void>,
  loadReposStatus: () => Promise<void>,
  render: () => void,
): Promise<void> {
  setRepoPhase(container, url, "Refreshing", "start");
  try {
    const res = await fetch(`${getBase()}/api/store/repos/refresh`, {
      method: "POST",
      headers: jsonHeaders(getToken),
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      setRepoPhase(container, url, "Refreshing", "failed");
      return;
    }
    setRepoPhase(container, url, "Refreshing", "ok");
    await refreshAndRender();
    void loadReposStatus().then(() => render());
  } catch {
    setRepoPhase(
      container,
      url,
      "Refreshing",
      "failed",
      t("settings-page.store.network-error"),
    );
  }
}

export async function handleRemove(
  url: string,
  repos: RepoInfo[],
  getToken: () => string | null,
  refreshAndRender: () => Promise<void>,
): Promise<void> {
  const fromRepo = repos.find((r) => r.url === url);
  if (!fromRepo) return;
  const res = await fetch(`${getBase()}/api/store/repos`, {
    method: "DELETE",
    headers: jsonHeaders(getToken),
    body: JSON.stringify({ url }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    alert(data.error || t("settings-page.store.failed-remove-repo"));
    return;
  }
  await refreshAndRender();
}

export async function handleInstall(
  container: HTMLElement,
  btn: HTMLButtonElement,
  getToken: () => string | null,
  loadItems: () => Promise<void>,
  render: () => void,
): Promise<void> {
  const { repoUrl, itemPath, type } = btn.dataset;
  if (!repoUrl || !itemPath || !type) return;
  if (
    type === "plugin" &&
    !(await confirmModal({
      title: t("settings-page.store.install-plugin-title"),
      message: t("settings-page.store.install-plugin-message"),
    }))
  )
    return;
  const key = { repoUrl, itemPath, type };
  btn.disabled = true;
  setItemPhase(container, key, "Installing", "start");
  try {
    const res = await fetch(`${getBase()}/api/store/install`, {
      method: "POST",
      headers: jsonHeaders(getToken),
      body: JSON.stringify({ repoUrl, itemPath, type }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setItemPhase(container, key, "Installing", "failed", data.error);
      return;
    }
    setItemPhase(container, key, "Installing", "ok");
    await loadItems();
    render();
    window.dispatchEvent(new CustomEvent("extensions-saved"));
  } catch {
    setItemPhase(
      container,
      key,
      "Installing",
      "failed",
      t("settings-page.store.network-error"),
    );
  } finally {
    btn.disabled = false;
  }
}

export async function handleUninstall(
  btn: HTMLButtonElement,
  getToken: () => string | null,
  loadItems: () => Promise<void>,
  render: () => void,
): Promise<void> {
  const { repoUrl, itemPath, type } = btn.dataset;
  if (
    !(await confirmModal({
      title: t("settings-page.store.uninstall-title"),
      message: t("settings-page.store.uninstall-message", {
        type: type ?? "item",
      }),
    }))
  )
    return;
  btn.disabled = true;
  try {
    const res = await fetch(`${getBase()}/api/store/uninstall`, {
      method: "POST",
      headers: jsonHeaders(getToken),
      body: JSON.stringify({ repoUrl, itemPath, type }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) alert(data.error || t("settings-page.store.uninstall-failed"));
    else {
      await loadItems();
      render();
      window.dispatchEvent(new CustomEvent("extensions-saved"));
    }
  } catch {
    alert(t("settings-page.store.network-error"));
  } finally {
    btn.disabled = false;
  }
}

export async function handleDeleteUntracked(
  btn: HTMLButtonElement,
  getToken: () => string | null,
  loadItems: () => Promise<void>,
  render: () => void,
): Promise<void> {
  const { folderName, type } = btn.dataset;
  if (
    !(await confirmModal({
      title: "Delete?",
      message: `Permanently delete this ${type ?? "extension"} from disk?`,
    }))
  )
    return;
  btn.disabled = true;
  try {
    const res = await fetch(`${getBase()}/api/store/untracked`, {
      method: "DELETE",
      headers: jsonHeaders(getToken),
      body: JSON.stringify({ folderName, type }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) alert(data.error || "Delete failed");
    else {
      await loadItems();
      render();
      window.dispatchEvent(new CustomEvent("extensions-saved"));
    }
  } catch {
    alert(t("settings-page.store.network-error"));
  } finally {
    btn.disabled = false;
  }
}

export async function handleUpdate(
  container: HTMLElement,
  btn: HTMLButtonElement,
  getToken: () => string | null,
  loadItems: () => Promise<void>,
  render: () => void,
): Promise<void> {
  const { repoUrl, itemPath, type } = btn.dataset;
  if (!repoUrl || !itemPath || !type) return;
  const key = { repoUrl, itemPath, type };
  btn.disabled = true;
  setItemPhase(container, key, "Updating", "start");
  try {
    const res = await fetch(`${getBase()}/api/store/update`, {
      method: "POST",
      headers: jsonHeaders(getToken),
      body: JSON.stringify({ repoUrl, itemPath, type }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setItemPhase(container, key, "Updating", "failed", data.error);
      return;
    }
    setItemPhase(container, key, "Updating", "ok");
    await loadItems();
    render();
    window.dispatchEvent(new CustomEvent("extensions-saved"));
    void maybeShowRestartNotice(getToken);
  } catch {
    setItemPhase(
      container,
      key,
      "Updating",
      "failed",
      t("settings-page.store.network-error"),
    );
  } finally {
    btn.disabled = false;
  }
}

export async function handleUpdateAll(
  container: HTMLElement,
  getToken: () => string | null,
  loadItems: () => Promise<void>,
  render: () => void,
): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>(
    ".store-btn-update-all",
  );
  if (btn) btn.disabled = true;
  try {
    await streamUpdateAll(container);
    try {
      await loadItems();
    } catch (err) {
      console.warn("[store] reload after update all failed", err);
    }
    render();
    window.dispatchEvent(new CustomEvent("extensions-saved"));
    void maybeShowRestartNotice(getToken);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function handleRefreshAll(
  container: HTMLElement,
  refreshAndRender: () => Promise<void>,
  loadReposStatus: () => Promise<void>,
  render: () => void,
): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>(
    ".store-btn-refresh-all",
  );
  if (btn) btn.disabled = true;
  try {
    await streamRefreshAll(container);
    try {
      await refreshAndRender();
    } catch (err) {
      console.warn("[store] reload after refresh all failed", err);
      render();
    }
    void loadReposStatus().then(() => render());
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function confirmRemoveRepo(_url: string): Promise<boolean> {
  const ok = await confirmModal({
    title: t("settings-page.store.remove-repo-title"),
    message: t("settings-page.store.remove-repo-message"),
  });
  return ok;
}
