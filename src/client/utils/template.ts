import { escapeHtml } from "./dom";

const PLACEHOLDER_RE = /\{\{\s*([^#/}][^}]*?)\s*\}\}/g;
const BLOCK_RE = /\{\{#(\w+)\s+([\w.]+)\}\}([\s\S]*?)\{\{\/\1\s+\2\}\}/g;

const _resolve = (key: string, ctx: Record<string, unknown>): unknown => {
  if (key === "." || key === "@index") return ctx[key];
  let val: unknown = ctx;
  for (const part of key.split(".")) {
    if (val == null || typeof val !== "object") return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return val;
};

const _processBlocks = (
  tpl: string,
  ctx: Record<string, unknown>,
): string =>
  tpl.replace(BLOCK_RE, (_, type: string, key: string, inner: string) => {
    const val = _resolve(key, ctx);
    if (type === "if") {
      if (!val || (Array.isArray(val) && val.length === 0)) return "";
      return _processBlocks(inner, ctx);
    }
    if (type === "each") {
      if (!Array.isArray(val)) return "";
      return val
        .map((item, i) => {
          const childCtx = { ...ctx, ".": item, "@index": i };
          return _fillPlaceholders(_processBlocks(inner, childCtx), childCtx);
        })
        .join("");
    }
    return "";
  });

const _fillPlaceholders = (
  tpl: string,
  ctx: Record<string, unknown>,
): string =>
  tpl.replace(PLACEHOLDER_RE, (_, key: string) => {
    const val = _resolve(key.trim(), ctx);
    if (val == null) return "";
    return escapeHtml(String(val));
  });

const _findTemplate = (templateId: string): HTMLTemplateElement | null => {
  const all = document.querySelectorAll<HTMLTemplateElement>(
    `template#${templateId}`,
  );
  return all.length > 0 ? all[all.length - 1] : null;
};

export const renderTemplate = (
  templateId: string,
  ctx: Record<string, unknown>,
): string | null => {
  const el = _findTemplate(templateId);
  if (!el) return null;
  const tpl = el.innerHTML;
  return _fillPlaceholders(_processBlocks(tpl, ctx), ctx);
};

export const hasTemplate = (templateId: string): boolean =>
  _findTemplate(templateId) !== null;
