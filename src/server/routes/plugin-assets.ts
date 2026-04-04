import { Hono } from "hono";
import { join } from "path";
import { getScriptFolderSource } from "../utils/plugin-assets";
import { pluginsDir as getPluginsDir, themesDir as getThemesDir } from "../utils/paths";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const pluginsDir = getPluginsDir();
const themesDataDir = getThemesDir();
const builtinsDir = join(
  process.cwd(),
  "src",
  "server",
  "extensions",
  "commands",
  "builtins",
);

const router = new Hono();

router.get("/plugins/:folder/*", async (c) => {
  const folder = c.req.param("folder");
  const rest = c.req.path.replace(`/plugins/${folder}/`, "");
  if (!rest || rest.includes("..") || rest.startsWith("index.")) {
    return c.notFound();
  }
  const ext = rest.substring(rest.lastIndexOf("."));
  const mime = MIME_TYPES[ext];
  if (!mime) return c.notFound();
  const source = getScriptFolderSource(folder);
  const rootDir = source === "builtin" ? builtinsDir : pluginsDir;
  const filePath = join(rootDir, folder, rest);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return c.notFound();
  c.header("Content-Type", mime);
  c.header("Cache-Control", "no-cache");
  return c.body(await file.arrayBuffer());
});

router.get("/themes/:folder/*", async (c) => {
  const folder = c.req.param("folder");
  const rest = c.req.path.replace(`/themes/${folder}/`, "");
  if (!rest || rest.includes("..") || rest.startsWith("index.") || rest === "theme.json") {
    return c.notFound();
  }
  const ext = rest.substring(rest.lastIndexOf("."));
  const mime = MIME_TYPES[ext];
  if (!mime) return c.notFound();
  const filePath = join(themesDataDir, folder, rest);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return c.notFound();
  c.header("Content-Type", mime);
  c.header("Cache-Control", "no-cache");
  return c.body(await file.arrayBuffer());
});

export default router;
