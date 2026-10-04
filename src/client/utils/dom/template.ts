import { renderTemplateString } from "../../../shared/template";

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
  return renderTemplateString(el.innerHTML, ctx);
};
