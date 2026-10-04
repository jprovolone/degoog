import { clear, render } from "../../../../shared/ui/tribute/dom";
import { ClearBody } from "./clear-body";
import { getBase } from "../../../utils/net/base-url";
import { jsonHeaders } from "../../../utils/net/request";
import { getStoredToken } from "../../../utils/settings/settings-token";
import { tr } from "../i18n";
import { borrowModal, claimModal, closeModal } from "../../../modules/modals/settings-modal/modal";

export const openClearModal = (onCleared: () => void): void => {
  const overlay = document.getElementById("ext-modal-overlay");
  const titleEl = document.getElementById("ext-modal-title");
  const bodyEl = document.getElementById("ext-modal-body");
  const statusEl = document.getElementById("ext-modal-status");
  const saveEl = document.getElementById(
    "ext-modal-save",
  ) as HTMLButtonElement | null;
  if (!overlay || !titleEl || !bodyEl || !statusEl || !saveEl) return;
  const owns = claimModal();

  titleEl.textContent = tr("clear-modal-title");
  render(<ClearBody />, bodyEl);
  statusEl.textContent = "";
  overlay.style.display = "";

  const _fail = (): void => {
    if (!owns()) return;
    statusEl.textContent = tr("clear-failed");
    saveEl.disabled = false;
  };

  const confirmClear = async (): Promise<void> => {
    const input = bodyEl.querySelector<HTMLInputElement>(
      "#indexer-clear-confirm",
    );
    if (input?.value.trim() !== "CLEAR") {
      statusEl.textContent = tr("clear-modal-desc");
      return;
    }
    saveEl.disabled = true;
    try {
      const res = await fetch(`${getBase()}/api/indexer/clear`, {
        method: "POST",
        headers: jsonHeaders(getStoredToken),
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        _fail();
        return;
      }
      if (owns()) closeModal();
      onCleared();
    } catch {
      _fail();
    }
  };

  borrowModal({ onSave: () => void confirmClear(), onClose: () => clear(bodyEl) });
  saveEl.textContent = tr("clear-confirm");
};
