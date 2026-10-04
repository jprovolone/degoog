import { clear, render } from "../../../../shared/ui/tribute/dom";
import { ImportBody } from "./import-body";
import { getBase } from "../../../utils/net/base-url";
import { authHeaders } from "../../../utils/net/request";
import { getStoredToken } from "../../../utils/settings/settings-token";
import { initFileUpload } from "../../../utils/file-upload/file-upload";
import { fetchEngineTypes, IMPORT_CUSTOM_TYPE } from "../api";
import { mountProgress, type ProgressUi } from "../progress/progress";
import { tr } from "../i18n";
import { borrowModal, claimModal, closeModal } from "../../../modules/modals/settings-modal/modal";

const CHUNK_BYTES = 8 * 1024 * 1024;
const PROGRESS_HOST_ID = "indexer-import-progress";

interface StartResponse {
  sessionId?: string;
  error?: string;
}

interface CompleteResponse {
  ok?: boolean;
  urls?: number;
  hits?: number;
  error?: string;
}

const uploadChunks = async (
  file: File,
  sessionId: string,
  bar: ProgressUi,
): Promise<boolean> => {
  const base = getBase();
  for (let pos = 0; pos < file.size; pos += CHUNK_BYTES) {
    const slice = file.slice(pos, Math.min(file.size, pos + CHUNK_BYTES));
    const res = await fetch(`${base}/api/indexer/import/chunk`, {
      method: "POST",
      headers: {
        ...authHeaders(getStoredToken),
        "Content-Type": "application/octet-stream",
        "x-import-session": sessionId,
      },
      body: await slice.arrayBuffer(),
    });
    if (!res.ok) return false;
    const sent = Math.min(file.size, pos + CHUNK_BYTES);
    bar.set(sent, file.size);
    bar.label(`${Math.round((sent / Math.max(file.size, 1)) * 100)}%`);
  }
  return true;
};

const runImport = async (
  type: string,
  file: File,
  hostEl: HTMLElement,
  setStatus: (text: string) => void,
): Promise<CompleteResponse | null> => {
  const base = getBase();
  const bar = mountProgress(hostEl);
  bar.label(tr("import-progress"));

  const startRes = await fetch(`${base}/api/indexer/import/start`, {
    method: "POST",
    headers: {
      ...authHeaders(getStoredToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type }),
  });
  const start = (await startRes.json().catch(() => ({}))) as StartResponse;
  if (!startRes.ok || !start.sessionId) {
    setStatus(start.error ?? `Import failed (${startRes.status})`);
    bar.finish(true);
    return null;
  }

  const uploaded = await uploadChunks(file, start.sessionId, bar);
  if (!uploaded) {
    setStatus(tr("import-progress"));
    bar.finish(true);
    return null;
  }

  bar.label(tr("import-processing"));
  const doneRes = await fetch(`${base}/api/indexer/import/complete`, {
    method: "POST",
    headers: {
      ...authHeaders(getStoredToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session: start.sessionId }),
  });
  const data = (await doneRes.json().catch(() => ({}))) as CompleteResponse;
  if (!doneRes.ok || !data.ok) {
    setStatus(data.error ?? `Import failed (${doneRes.status})`);
    bar.finish(true);
    return null;
  }

  bar.finish();
  return data;
};

export const openImportModal = async (onDone: () => void): Promise<void> => {
  const overlay = document.getElementById("ext-modal-overlay");
  const titleEl = document.getElementById("ext-modal-title");
  const bodyEl = document.getElementById("ext-modal-body");
  const statusEl = document.getElementById("ext-modal-status");
  const saveEl = document.getElementById(
    "ext-modal-save",
  ) as HTMLButtonElement | null;
  if (!overlay || !titleEl || !bodyEl || !statusEl || !saveEl) return;
  const owns = claimModal();

  const engineTypes = await fetchEngineTypes();
  if (!owns()) return;

  titleEl.textContent = tr("import-modal-title");
  render(
    <ImportBody
      engineTypes={engineTypes}
      customTypeValue={IMPORT_CUSTOM_TYPE}
      progressHostId={PROGRESS_HOST_ID}
    />,
    bodyEl,
  );
  statusEl.textContent = "";
  overlay.style.display = "";

  const typeEl = bodyEl.querySelector<HTMLSelectElement>(
    "#indexer-import-type",
  );
  const customTypeEl = bodyEl.querySelector<HTMLInputElement>(
    "#indexer-import-custom-type",
  );

  typeEl?.addEventListener("change", () => {
    if (!customTypeEl) return;
    customTypeEl.hidden = typeEl.value !== IMPORT_CUSTOM_TYPE;
    if (!customTypeEl.hidden) customTypeEl.focus();
  });

  initFileUpload(bodyEl);

  let running = false;
  let finished = false;

  const showSave = (): void => {
    if (!owns()) return;
    saveEl.disabled = false;
    saveEl.hidden = false;
  };

  const setStatus = (text: string): void => {
    if (owns()) statusEl.textContent = text;
  };

  const onSave = async (): Promise<void> => {
    if (finished) {
      closeModal();
      return;
    }
    if (running) return;
    const sel = bodyEl.querySelector<HTMLSelectElement>("#indexer-import-type");
    const customEl = bodyEl.querySelector<HTMLInputElement>(
      "#indexer-import-custom-type",
    );
    const fileEl = bodyEl.querySelector<HTMLInputElement>(
      "#indexer-import-file",
    );
    const type =
      sel?.value === IMPORT_CUSTOM_TYPE
        ? customEl?.value.trim()
        : sel?.value.trim();
    const file = fileEl?.files?.[0];
    if (!type || !file) {
      statusEl.textContent = tr("import-missing");
      return;
    }
    const host = bodyEl.querySelector<HTMLElement>(`#${PROGRESS_HOST_ID}`);
    if (!host) return;

    running = true;
    saveEl.disabled = true;
    saveEl.hidden = true;

    try {
      const data = await runImport(type, file, host, setStatus);
      if (!data) {
        showSave();
        return;
      }
      onDone();
      if (!owns()) return;
      setStatus(
        tr("import-done", {
          type,
          urls: String(data.urls ?? 0),
          hits: String(data.hits ?? 0),
        }),
      );
      finished = true;
      saveEl.textContent = tr("import-close");
      showSave();
    } catch {
      setStatus("Import failed");
      showSave();
    } finally {
      running = false;
    }
  };

  borrowModal({
    onSave: () => void onSave(),
    onClose: () => clear(bodyEl),
  });
  saveEl.textContent = tr("import-btn");
};
