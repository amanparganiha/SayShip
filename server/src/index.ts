/**
 * Production entry point (bundled to dist/server.js). Serves the built client from dist/public.
 */
import path from "node:path";
import express from "express";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadEnv } from "./env";
import { createLlm } from "./llm";
import { getRuntimeAssets } from "./sandbox/runtimeAssets";

// Nothing reads NODE_ENV at import time, so defaulting it here (after hoisted imports) is safe.
process.env.NODE_ENV ??= "production";
const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
await runMigrations(pool);
// Bundle React/Tailwind for generated apps now, so the first preview doesn't pay for it.
void getRuntimeAssets();

const publicDir = path.resolve("dist/public");

const app = createApp(
  { env, db, llm: createLlm(env) },
  {
    frontend: (app) => {
      app.use(
        "/assets",
        express.static(path.join(publicDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }),
      );
      app.use(express.static(publicDir, { index: false }));
      // SPA fallback for client-side routes.
      app.get("/{*splat}", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
    },
  },
);

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`SayShip listening on :${env.PORT} (LLM: ${env.llmProvider})`);
});
