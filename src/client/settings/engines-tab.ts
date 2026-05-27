import { idbGet, idbSet } from "../utils/db";
import { SETTINGS_KEY } from "../constants";
import { escapeHtml, getConfigStatus } from "../utils/dom";
import { openModal } from "../modules/modals/settings-modal/modal";
import type { ExtensionMeta, EngineRecord, AllExtensions } from "../types";
import { getBase } from "../utils/base-url";
import { renderMdInline } from "../utils/md";

const t = window.scopedT("core");
const themeT = window.scopedT("themes/degoog");

const _typeLabel = (type: string): string => {
  const translated = themeT(`search-templates.tabs.${type}`);
  return translated !== `search-templates.tabs.${type}`
    ? translated
    : type.charAt(0).toUpperCase() + type.slice(1);
};

const _engineTypes = (engine: ExtensionMeta): string[] => {
  if (engine.searchTypes?.length) return engine.searchTypes;
  return [engine.primaryType ?? "web"];
};

const _primaryType = (types: string[]): string =>
  types.length > 0 ? types[0] : "web";

const _groupByType = (
  engines: ExtensionMeta[],
): { key: string; label: string; engines: ExtensionMeta[] }[] => {
  const map = new Map<string, ExtensionMeta[]>();
  for (const engine of engines) {
    const key = _primaryType(_engineTypes(engine)).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(engine);
  }
  return [...map.keys()]
    .sort((a, b) => {
      if (a === "web") return -1;
      if (b === "web") return 1;
      return a.localeCompare(b);
    })
    .map((key) => ({
      key,
      label: _typeLabel(key),
      engines: map.get(key) ?? [],
    }));
};

const _extraTypeLabels = (engine: ExtensionMeta): string[] => {
  const types = _engineTypes(engine);
  const primary = _primaryType(types).toLowerCase();
  return types
    .filter((type) => type.toLowerCase() !== primary)
    .map((type) => _typeLabel(type.toLowerCase()));
};

const _renderEngineCard = (
  engine: ExtensionMeta,
  enabledMap: EngineRecord,
  allowConfigure: boolean,
): string => {
  const isEnabled = enabledMap[engine.id] !== false;
  const desc = engine.description
    ? `<span class="ext-card-desc">${renderMdInline(engine.description)}</span>`
    : "";
  const versionWarning = engine.requiresNewerVersion
    ? `<span class="ext-version-warning">${escapeHtml(t("settings-page.extensions.requires-newer-version"))}</span>`
    : "";
  const extraTypes = _extraTypeLabels(engine);
  const extraTypesHtml = extraTypes.length
    ? `<div class="ext-card-extra-types"><span class="ext-card-extra-types-label">${escapeHtml(t("settings-page.extensions.extra-types"))}</span>${extraTypes.map((label) => `<span class="degoog-badge degoog-badge--engine-type">${escapeHtml(label)}</span>`).join("")}</div>`
    : "";
  const status =
    allowConfigure && engine.configurable ? getConfigStatus(engine) : null;
  const badge =
    status === "configured"
      ? '<span class="ext-configured-badge" data-tooltip="' + escapeHtml(t("settings-page.extensions.status-configured")) + '"></span>'
      : status === "needs-config"
        ? '<span class="ext-needs-config-badge" data-tooltip="' + escapeHtml(t("settings-page.extensions.status-needs-config")) + '"></span>'
        : "";
  const configureBtn =
    allowConfigure && engine.configurable
      ? `<button class="ext-card-configure btn btn--secondary degoog-btn degoog-btn--secondary" data-id="${escapeHtml(engine.id)}" type="button">${escapeHtml(t("settings-page.extensions.configure"))}</button>`
      : "";
  return `
    <div class="ext-card degoog-panel degoog-panel--ext-card" data-id="${escapeHtml(engine.id)}">
      <div class="ext-card-main">
        <div class="ext-card-info">
          <label for="engine-toggle-${escapeHtml(engine.id)}" class="ext-card-name engine-toggle-label">${escapeHtml(engine.displayName)}</label>
          ${desc}
          ${extraTypesHtml}
          ${versionWarning}
        </div>
        <div class="ext-card-actions">
          ${badge}
          ${configureBtn}
          <label class="engine-toggle degoog-toggle-wrap degoog-toggle-wrap--transparent">
            <input type="checkbox" class="engine-toggle-input" id="engine-toggle-${escapeHtml(engine.id)}" data-id="${escapeHtml(engine.id)}" ${isEnabled ? "checked" : ""}>
            <span class="toggle-slider degoog-toggle"></span>
          </label>
        </div>
      </div>
    </div>`;
};

export async function initEnginesTab(
  allExtensions: AllExtensions,
  options?: { publicInstance?: boolean },
): Promise<void> {
  const container = document.getElementById("engines-content");
  if (!container) return;
  const allowConfigure = !options?.publicInstance;

  const savedEngines = await idbGet<EngineRecord>(SETTINGS_KEY);
  const savedEnginesMap = savedEngines || {};
  const defaultsFromEngines = Object.fromEntries(
    allExtensions.engines.map((e) => [e.id, e.defaultEnabled !== false]),
  );
  const enabledMap: EngineRecord = {
    ...defaultsFromEngines,
    ...savedEnginesMap,
  };

  const groups = _groupByType(allExtensions.engines);
  let html = "";
  for (const { label, engines } of groups) {
    html += `<div class="ext-group"><h3 class="ext-group-label">${escapeHtml(label)}</h3><div class="ext-cards">`;
    for (const engine of engines) {
      html += _renderEngineCard(engine, enabledMap, allowConfigure);
    }
    html += `</div></div>`;
  }
  if (allowConfigure) {
    html += `<div class="settings-page-actions"><button class="btn btn--secondary degoog-btn degoog-btn--secondary" id="save-default-engines" type="button">${t("settings-page.extensions.save-defaults")}</button></div>`;
  }
  container.innerHTML = html;

  container
    .querySelectorAll<HTMLInputElement>(".engine-toggle-input")
    .forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.id;
        if (id) enabledMap[id] = input.checked;
        await idbSet(SETTINGS_KEY, enabledMap);
      });
    });

  if (allowConfigure) {
    container
      .querySelectorAll<HTMLElement>(".ext-card-configure")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const ext = allExtensions.engines.find((e) => e.id === id);
          if (ext) openModal(ext);
        });
      });

    document
      .getElementById("save-default-engines")
      ?.addEventListener("click", async () => {
        const btn = document.getElementById("save-default-engines");
        try {
          const token = sessionStorage.getItem("degoog-settings-token");
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) headers["x-settings-token"] = token;
          await fetch(`${getBase()}/api/settings/default-engines`, {
            method: "POST",
            headers,
            body: JSON.stringify(enabledMap),
          });
          if (btn) {
            const prev = btn.textContent;
            btn.textContent = t("settings-page.server.saved");
            setTimeout(() => {
              btn.textContent = prev;
            }, 1200);
          }
        } catch {
          if (btn)
            btn.textContent = t("settings-page.server.save-failed-network");
        }
      });
  }
}
