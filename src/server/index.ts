import index from "../client/index.html";
import { config } from "./config.ts";
import { Cache } from "./lib/cache.ts";
import { logger } from "./lib/logger.ts";
import { SourceStore } from "./lib/source-store.ts";
import { createApiRoutes } from "./routes/api.ts";
import { sources } from "./sources/index.ts";

const cache = new Cache(config.cacheDb);
const store = new SourceStore(cache, sources);
if (config.schedulerEnabled) store.startScheduler();

const server = Bun.serve({
  port: config.port,
  development: !config.isProduction && { hmr: true, console: true },
  routes: {
    ...createApiRoutes(store),
    // Everything else is the single-page app; Bun bundles it from the HTML import.
    "/*": index,
  },
  error(err) {
    logger.error(err.stack ?? err.message);
    return new Response("Internal error", { status: 500 });
  },
});

logger.info(`Climate dashboard running at ${server.url}`);

function shutdown() {
  store.stop();
  server.stop();
  cache.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
