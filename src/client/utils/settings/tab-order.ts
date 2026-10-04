import { getBase } from "../net/base-url";
import { jsonHeaders } from "../net/request";

export const getTabOrder = async (): Promise<string[]> => {
  try {
    const res = await fetch(`${getBase()}/api/settings/tab-order`);
    if (!res.ok) return [];
    const data = (await res.json()) as { engineTabsOrder?: unknown };
    return Array.isArray(data.engineTabsOrder)
      ? (data.engineTabsOrder as string[])
      : [];
  } catch {
    return [];
  }
};

export const saveTabOrder = async (
  order: string[],
  token: string | null,
): Promise<boolean> => {
  try {
    const res = await fetch(`${getBase()}/api/settings/tab-order`, {
      method: "POST",
      headers: jsonHeaders(() => token),
      body: JSON.stringify({ engineTabsOrder: order }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const applyTabOrder = (types: string[], saved: string[]): string[] => {
  if (!saved.length) return types;
  const seen = new Set(saved);
  const ordered = saved.filter((k) => types.includes(k));
  const rest = types.filter((k) => !seen.has(k));
  return [...ordered, ...rest];
};
