import { render } from "../../../../shared/ui/tribute/dom";
import { StoreProgressOverlay } from "./progress-overlay";
import { getBase } from "../../../utils/net/base-url";
import {
  isStoreEvent,
  type StoreStreamEvent,
  type StoreStreamPhase,
} from "../../../../shared/store-stream";

const t = window.scopedT("core");

type Phase = StoreStreamPhase;

export interface ItemKey {
  repoUrl: string;
  itemPath: string;
  type: string;
}

const esc = (v: string): string => v.replace(/"/g, '\\"');

function itemTargets(container: HTMLElement, key: ItemKey): HTMLElement[] {
  const attr = `[data-repo-url="${esc(key.repoUrl)}"][data-item-path="${esc(key.itemPath)}"][data-type="${esc(key.type)}"]`;
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `.store-card${attr}, .store-updates-row${attr}`,
    ),
  );
}

function repoTargets(container: HTMLElement, url: string): HTMLElement[] {
  const attr = `[data-url="${esc(url)}"]`;
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `.store-repo-item${attr}, .store-repo-detail${attr}`,
    ),
  );
}

function ensureOverlay(el: HTMLElement): HTMLElement {
  let overlay = el.querySelector<HTMLElement>(":scope > .store-progress");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "store-progress";
    render(<StoreProgressOverlay />, overlay);
    el.appendChild(overlay);
  }
  return overlay;
}

const FAILED_CLEAR_MS = 4000;

const failedTimers = new WeakMap<HTMLElement, number>();

function scheduleFailedClear(el: HTMLElement, overlay: HTMLElement): void {
  window.clearTimeout(failedTimers.get(el));
  failedTimers.set(
    el,
    window.setTimeout(() => {
      if (!el.classList.contains("is-failed")) return;
      if (overlay.parentElement !== el) return;
      overlay.remove();
      el.classList.remove("is-failed", "store-progress-host");
    }, FAILED_CLEAR_MS),
  );
}

function applyPhase(
  els: HTMLElement[],
  verb: string,
  phase: Phase,
  error?: string,
): void {
  for (const el of els) {
    el.classList.add("store-progress-host");
    const overlay = ensureOverlay(el);
    const label = overlay.querySelector<HTMLElement>(".store-progress-label");
    el.classList.remove("is-working", "is-ok", "is-failed");
    if (phase === "start") {
      el.classList.add("is-working");
      if (label) label.textContent = `${verb}…`;
    } else if (phase === "ok") {
      el.classList.add("is-ok");
      if (label) label.textContent = t("settings-page.store.progress-done");
    } else {
      el.classList.add("is-failed");
      if (label) label.textContent = error || t("settings-page.store.progress-failed");
      scheduleFailedClear(el, overlay);
    }
  }
}

export function setItemPhase(
  container: HTMLElement,
  key: ItemKey,
  verb: string,
  phase: Phase,
  error?: string,
): void {
  applyPhase(itemTargets(container, key), verb, phase, error);
}

export function setRepoPhase(
  container: HTMLElement,
  url: string,
  verb: string,
  phase: Phase,
  error?: string,
): void {
  applyPhase(repoTargets(container, url), verb, phase, error);
}

function streamStoreOp(
  path: string,
  event: string,
  onEvent: (e: StoreStreamEvent) => void,
): Promise<{ failed: number } | null> {
  return new Promise((resolve) => {
    const url = `${getBase()}${path}`;
    const source = new EventSource(url);
    let failed = 0;

    source.addEventListener(event, (e) => {
      const data: unknown = JSON.parse((e as MessageEvent).data);
      if (!isStoreEvent(data)) return;
      if (data.phase === "failed") failed++;
      onEvent(data);
    });

    source.addEventListener("done", (e) => {
      source.close();
      let data: unknown = null;
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch (err) {
        console.warn("[store] unreadable stream summary", err);
      }
      const reported =
        typeof data === "object" &&
        data !== null &&
        typeof (data as { failed?: unknown }).failed === "number"
          ? (data as { failed: number }).failed
          : failed;
      resolve({ failed: reported });
    });

    source.addEventListener("failed", () => {
      source.close();
      resolve(null);
    });

    source.onerror = () => {
      source.close();
      resolve(null);
    };
  });
}

export function streamUpdateAll(
  container: HTMLElement,
): Promise<{ failed: number } | null> {
  return streamStoreOp("/api/store/update-all/stream", "item", (e) => {
    if (!e.repoUrl || !e.itemPath || !e.type) return;
    setItemPhase(
      container,
      { repoUrl: e.repoUrl, itemPath: e.itemPath, type: e.type },
      "Updating",
      e.phase,
      e.error,
    );
  });
}

export function streamRefreshAll(
  container: HTMLElement,
): Promise<{ failed: number } | null> {
  return streamStoreOp("/api/store/repos/refresh/stream", "repo", (e) => {
    if (!e.url) return;
    setRepoPhase(container, e.url, "Refreshing", e.phase, e.error);
  });
}
