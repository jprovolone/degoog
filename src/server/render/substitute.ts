const HEAD_END = "</head>";

export const sub = (html: string, key: string, value: string): string =>
  html.replaceAll(key, () => value);

export const subFirst = (html: string, key: string, value: string): string =>
  html.replace(key, () => value);

export const beforeHeadEnd = (html: string, fragment: string): string =>
  subFirst(html, HEAD_END, `${fragment}\n  ${HEAD_END}`);

export const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");
