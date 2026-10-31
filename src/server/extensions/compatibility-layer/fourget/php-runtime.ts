import { logger } from "../../../utils/logger";

const NS = "4get-compat";
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_TTL_MS = 60_000;
const MIN_PHP_MAJOR = 8;
const MIN_PHP_MINOR = 1;

enum PhpExt {
  Sodium = "sodium",
  Mbstring = "mbstring",
  Zlib = "zlib",
}

export const EXT_PACKAGES: Record<PhpExt, string> = {
  [PhpExt.Sodium]: "php-sodium",
  [PhpExt.Mbstring]: "php-mbstring",
  [PhpExt.Zlib]: "php-zlib",
};

const ALL_EXTS = Object.values(PhpExt);

const PROBE_SNIPPET =
  'echo json_encode(["version"=>PHP_VERSION,"major"=>PHP_MAJOR_VERSION,' +
  '"minor"=>PHP_MINOR_VERSION,"ext"=>array_map("strtolower",get_loaded_extensions()),' +
  '"disabled"=>(string)ini_get("disable_functions")]);';

interface PhpStatus {
  ok: boolean;
  version: string | null;
  missingExts: PhpExt[];
  disabledFunctions: string[];
  reason: string | null;
}

interface ProbePayload {
  version: string;
  major: number;
  minor: number;
  ext: string[];
  disabled: string;
}

export const phpBinary = (): string => process.env.DEGOOG_PHP_BIN ?? "php";

const DISABLED_FUNCTIONS = [
  "exec",
  "shell_exec",
  "system",
  "passthru",
  "proc_open",
  "popen",
  "pcntl_exec",
  "pcntl_fork",
  "putenv",
  "dl",
  "mail",
  "mb_send_mail",
  "imap_open",
  "imap_mail",
];

export const phpRunnerArgs = (hostDisabled: string[] = []): string[] => [
  "-d",
  "display_errors=stderr",
  "-d",
  "html_errors=0",
  "-d",
  "sendmail_path=/bin/false",
  "-d",
  "ffi.enable=0",
  "-d",
  `disable_functions=${[...new Set([...hostDisabled, ...DISABLED_FUNCTIONS])].join(",")}`,
];

const _parseDisabled = (raw: unknown): string[] =>
  typeof raw === "string"
    ? raw
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : [];

const _probe = async (): Promise<PhpStatus> => {
  const proc = Bun.spawn([phpBinary(), "-d", "display_errors=stderr", "-r", PROBE_SNIPPET], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const [out, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`php probe exited with ${exitCode}`);
  const parsed = JSON.parse(out.trim() || "{}") as Partial<ProbePayload>;
  const loaded = new Set(parsed.ext ?? []);
  const missingExts = ALL_EXTS.filter((ext) => !loaded.has(ext));
  const major = parsed.major ?? 0;
  const minor = parsed.minor ?? 0;
  const tooOld = major < MIN_PHP_MAJOR || (major === MIN_PHP_MAJOR && minor < MIN_PHP_MINOR);
  const reasons: string[] = [];
  if (tooOld) {
    reasons.push(`php ${parsed.version ?? "?"} is older than ${MIN_PHP_MAJOR}.${MIN_PHP_MINOR}`);
  }
  if (missingExts.length > 0) {
    reasons.push(`missing extensions: ${missingExts.map((e) => EXT_PACKAGES[e]).join(", ")}`);
  }
  return {
    ok: reasons.length === 0,
    version: parsed.version ?? null,
    missingExts,
    disabledFunctions: _parseDisabled(parsed.disabled),
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
};

let _cached: { at: number; status: PhpStatus } | null = null;
let _hostDisabled: string[] = [];

export const hostDisabledFunctions = (): string[] => _hostDisabled;

export const phpStatus = async (): Promise<PhpStatus> => {
  if (_cached && Date.now() - _cached.at < PROBE_TTL_MS) return _cached.status;
  let status: PhpStatus;
  try {
    status = await _probe();
    _hostDisabled = status.disabledFunctions;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      NS,
      `no usable php (${phpBinary()}): ${message}. Install php-cli ${MIN_PHP_MAJOR}.${MIN_PHP_MINOR}+ ` +
        `with ${ALL_EXTS.map((e) => EXT_PACKAGES[e]).join(", ")}, or point DEGOOG_PHP_BIN at it.`,
    );
    status = {
      ok: false,
      version: null,
      missingExts: [...ALL_EXTS],
      disabledFunctions: [],
      reason: `php not runnable: ${message}`,
    };
  }
  _cached = { at: Date.now(), status };
  return status;
};

export const resetPhpProbe = (): void => {
  _cached = null;
};
