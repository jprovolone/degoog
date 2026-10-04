import { state } from "../../state";
import { LEAKS_ALLOWED_COOKIE } from "../../../shared/leak-guard";

function _keepPostSearch(): void {
  if (!state.postMethodEnabled || !state.currentQuery) return;
  try {
    sessionStorage.setItem("degoog-post-query", state.currentQuery);
    sessionStorage.setItem("degoog-post-type", state.currentType || "web");
    sessionStorage.setItem("degoog-post-page", String(state.currentPage || 1));
  } catch (err) {
    console.debug("[leak-guard] could not keep the search across reload", err);
  }
}

export function allowLeaksForSession(): void {
  document.cookie = `${LEAKS_ALLOWED_COOKIE}=1; path=/; samesite=strict`;
  _keepPostSearch();
  window.location.reload();
}
