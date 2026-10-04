import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ISOLATED = [
  "DEGOOG_SERVER_SETTINGS_FILE",
  "DEGOOG_INDEXER_DIR",
  "DEGOOG_PUBLIC_INSTANCE",
  "DEGOOG_SETTINGS_PASSWORDS",
  "DEGOOG_DANGEROUSLY_NO_PASSWORD",
  "DEGOOG_BASE_URL",
] as const;

export interface IsolatedEnv {
  dir: string;
  restore: () => void;
}

export const isolateFaviconEnv = (prefix: string): IsolatedEnv => {
  const saved: Record<string, string | undefined> = {};
  for (const key of ISOLATED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DEGOOG_SERVER_SETTINGS_FILE = join(dir, "server-settings.json");
  process.env.DEGOOG_INDEXER_DIR = join(dir, "indexer");
  return {
    dir,
    restore: () => {
      for (const key of ISOLATED) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
