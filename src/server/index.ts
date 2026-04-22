import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import pkg from "../../package.json";
import { initPlugins } from "./extensions/commands/registry";
import {
  getOutgoingAllowlist,
  initEngines,
} from "./extensions/engines/registry";
import { initMiddlewareRegistry } from "./extensions/middleware/registry";
import { initPluginRoutes } from "./extensions/plugin-routes/registry";
import { initSearchBarActions } from "./extensions/search-bar/registry";
import { initSearchResultTabs } from "./extensions/search-result-tabs/registry";
import { initSlotPlugins } from "./extensions/slots/registry";
import { initThemes } from "./extensions/themes/registry";
import { initTransports } from "./extensions/transports/registry";
import globalRouter from "./routes";
import { setOutgoingAllowlist } from "./utils/outgoing";

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
});

app.use("/public/*.js", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-cache");
});
app.use("/public/*", serveStatic({ root: "src/" }));
app.route("/", globalRouter);

const port = Number(process.env.DEGOOG_PORT) || 4444;

console.log(`\x1b[0m ____
/\\  _\`\\
\\ \\ \\/\\ \\     __     __     ___     ___      __
 \\ \\ \\ \\ \\  /'__\`\\ /'_ \`\\  / __\`\\  / __\`\\  /'_ \`\\
  \\ \\ \\_\\ \\/\\  __//\\ \\L\\ \\/\\ \\L\\ \\/\\ \\L\\ \\/\\ \\L\\ \\
   \\ \\____/\\ \\____\\ \\____ \\ \\____/\\ \\____/\\ \\____ \\
    \\/___/  \\/____/\\/___L\\ \\/___/  \\/___/  \\/___L\\ \\
                     /\\____/                 /\\____/
                     \\_/__/                  \\_/__/
`);
console.log("====================================================\n");

Promise.all([
  initTransports(),
  initEngines(),
  initPlugins(),
  initSlotPlugins(),
  initSearchResultTabs(),
  initSearchBarActions(),
  initPluginRoutes(),
  initMiddlewareRegistry(),
  initThemes(),
]).then(() => {
  setOutgoingAllowlist(getOutgoingAllowlist());
  Bun.serve({ port, fetch: app.fetch, idleTimeout: 120 });

  console.log(`\x1b[90mdegoog v${pkg.version}\x1b[0m`);
  console.log(`Running on http://localhost:${port}`);
});
