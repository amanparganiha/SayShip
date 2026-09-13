/**
 * Development entry point: one port for everything. Vite runs in middleware mode inside Express,
 * so API, preview and client (with HMR) share the same origin, just like production on Replit.
 */
import http from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadEnv } from "./env";
import { createLlm } from "./llm";
import { getRuntimeAssets } from "./sandbox/runtimeAssets";

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
await runMigrations(pool);
void getRuntimeAssets();

const httpServer = http.createServer();
const vite = await createViteServer({
  configFile: path.resolve("client/vite.config.ts"),
  // HMR websocket shares the HTTP server (and therefore the single exposed port). In a Replit
  // workspace the browser reaches us through Replit's HTTPS proxy on 443, not on our local port.
  server: {
    middlewareMode: true,
    ws: { server: httpServer, ...(process.env.REPLIT_DEV_DOMAIN ? { clientPort: 443 } : {}) },
  },
  appType: "spa",
});

const app = createApp({ env, db, llm: createLlm(env) }, { frontend: (app) => app.use(vite.middlewares) });
httpServer.on("request", app);
httpServer.listen(env.PORT, "0.0.0.0", () => {
  console.log(`SayShip dev server on http://localhost:${env.PORT} (LLM: ${env.llmProvider})`);
});
