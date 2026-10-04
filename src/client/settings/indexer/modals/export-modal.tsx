import { clear, render } from "../../../../shared/ui/tribute/dom";
import { ExportBody } from "./export-body";
import { authHeaders } from "../../../utils/net/request";
import { getStoredToken } from "../../../utils/settings/settings-token";
import type { IndexerStats } from "../../../../shared/indexer";
import { canSaveStream, downloadIndexerExport } from "../download";
import { orderTypes } from "../api";
import { mountProgress } from "../progress/progress";
import { tr } from "../i18n";
import { borrowModal, claimModal } from "../../../modules/modals/settings-modal/modal";

interface ExportEls {
  overlay: HTMLElement;
  titleEl: HTMLElement;
  bodyEl: HTMLElement;
  statusEl: HTMLElement;
  saveEl: HTMLButtonElement;
}

const getEls = (): ExportEls | null => {
  const overlay = document.getElementById("ext-modal-overlay");
  const titleEl = document.getElementById("ext-modal-title");
  const bodyEl = document.getElementById("ext-modal-body");
  const statusEl = document.getElementById("ext-modal-status");
  const saveEl = document.getElementById(
    "ext-modal-save",
  ) as HTMLButtonElement | null;
  if (!overlay || !titleEl || !bodyEl || !statusEl || !saveEl) return null;
  return { overlay, titleEl, bodyEl, statusEl, saveEl };
};

const _warnKey = (): string =>
  window.isSecureContext ? "export-memory-warning" : "export-insecure-warning";

const runExport = async (
  type: string,
  els: ExportEls,
  owns: () => boolean,
): Promise<void> => {
  els.saveEl.hidden = true;
  clear(els.bodyEl);
  const bar = mountProgress(els.bodyEl);
  bar.label(tr("export-btn"));

  await downloadIndexerExport(type, {
    headers: authHeaders(getStoredToken),
    onStatus: (text) => {
      if (text && owns()) {
        els.statusEl.textContent = text;
        bar.finish(true);
      }
    },
    onProgress: (done, total) => {
      bar.set(done, total);
      bar.label(`${Math.round((done / Math.max(total, 1)) * 100)}%`);
    },
  });

  if (owns() && !els.statusEl.textContent) {
    bar.finish();
    bar.label(tr("export-done"));
  }
};

export const openExportModal = (stats: IndexerStats | null): void => {
  const types = orderTypes(Object.keys(stats?.byType ?? {}));
  if (types.length === 0) return;

  const els = getEls();
  if (!els) return;
  const owns = claimModal();

  els.titleEl.textContent = tr("export-modal-title");
  els.statusEl.textContent = "";
  els.overlay.style.display = "";

  let started = false;
  const start = (type: string): void => {
    if (started) return;
    started = true;
    void runExport(type, els, owns);
  };

  borrowModal({
    onSave: () => {
      const sel = els.bodyEl.querySelector<HTMLSelectElement>(
        "#indexer-export-type",
      );
      const type = sel?.value ?? types[0];
      if (type) start(type);
    },
    onClose: () => clear(els.bodyEl),
  });

  const streams = canSaveStream();
  if (types.length === 1 && streams) {
    start(types[0]);
    return;
  }

  render(
    <ExportBody
      warningKey={streams ? undefined : _warnKey()}
      showPicker={types.length > 1}
    />,
    els.bodyEl,
  );

  if (types.length > 1) {
    const select = document.createElement("select");
    select.id = "indexer-export-type";
    select.className = "degoog-input";
    for (const type of types) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      select.append(option);
    }
    els.bodyEl.querySelector(".degoog-select-wrap")?.append(select);
  }

  els.saveEl.textContent = tr("export-btn");
};
