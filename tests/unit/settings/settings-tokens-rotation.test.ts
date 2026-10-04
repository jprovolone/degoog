import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "degoog-token-rotation-"));
const tokensFile = join(dir, "settings-tokens.json");
const saved = {
  file: process.env.DEGOOG_SETTINGS_TOKENS_FILE,
  passwords: process.env.DEGOOG_SETTINGS_PASSWORDS,
};
process.env.DEGOOG_SETTINGS_TOKENS_FILE = tokensFile;

let boots = 0;

type TokensModule = typeof import("../../../src/server/utils/settings/settings-tokens");

const boot = async (passwords: string | undefined): Promise<TokensModule> => {
  if (passwords === undefined) delete process.env.DEGOOG_SETTINGS_PASSWORDS;
  else process.env.DEGOOG_SETTINGS_PASSWORDS = passwords;
  const mod = (await import(
    `../../../src/server/utils/settings/settings-tokens.ts?boot=${++boots}`
  )) as TokensModule;
  await Bun.sleep(20);
  return mod;
};

const flush = (): Promise<void> => Bun.sleep(300);

const later = (): number => Date.now() + 60_000;

afterAll(() => {
  if (saved.file === undefined) delete process.env.DEGOOG_SETTINGS_TOKENS_FILE;
  else process.env.DEGOOG_SETTINGS_TOKENS_FILE = saved.file;
  if (saved.passwords === undefined) delete process.env.DEGOOG_SETTINGS_PASSWORDS;
  else process.env.DEGOOG_SETTINGS_PASSWORDS = saved.passwords;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => rmSync(tokensFile, { force: true }));

describe("persisted settings sessions and password rotation", () => {
  test("sessions survive a restart when the passwords are unchanged", async () => {
    const first = await boot("alpha,beta");
    first.tokenStore.set("keep-me", later());
    await flush();

    const second = await boot("beta, alpha");
    expect(second.tokenStore.get("keep-me")).toBeDefined();
  });

  test("changing DEGOOG_SETTINGS_PASSWORDS signs every session out on the next boot", async () => {
    const first = await boot("alpha");
    first.tokenStore.set("old-session", later());
    await flush();

    const second = await boot("rotated");
    expect(second.tokenStore.get("old-session")).toBeUndefined();
    await flush();
    expect(readFileSync(tokensFile, "utf-8")).not.toContain("old-session");
  });

  test("the fingerprint on disk is salted and never the password itself", async () => {
    const first = await boot("hunter2");
    first.tokenStore.set("s", later());
    await flush();
    const raw = readFileSync(tokensFile, "utf-8");
    expect(raw).not.toContain("hunter2");
    expect(JSON.parse(raw).__passwords).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  test("a tokens file from before fingerprints keeps its sessions", async () => {
    writeFileSync(tokensFile, JSON.stringify({ "legacy-session": later() }));
    const mod = await boot("alpha");
    expect(mod.tokenStore.get("legacy-session")).toBeDefined();
    await flush();
    expect(JSON.parse(readFileSync(tokensFile, "utf-8")).__passwords).toBeString();
  });

  test("the generated one-off password mode keeps sessions across restarts as before", async () => {
    const first = await boot(undefined);
    first.tokenStore.set("dev-session", later());
    await flush();

    const second = await boot(undefined);
    expect(second.tokenStore.get("dev-session")).toBeDefined();
  });
});
