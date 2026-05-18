import { marked } from "marked";
import DOMPurify from "dompurify";

export const renderMdInline = (text: string): string => {
  if (!text) return "";
  const html = marked.parseInline(text) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
};
