import compression from "compression";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import { loadUser, originCheck } from "./auth/middleware";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { errorHandler } from "./lib/http";
import type { LlmClient } from "./llm";
import { authRouter } from "./routes/auth";
import { dataRouter } from "./routes/data";
import { generateRouter } from "./routes/generate";
import { githubRouter } from "./routes/github";
import { healthRouter } from "./routes/health";
import { previewRouter } from "./routes/preview";
import { projectsRouter } from "./routes/projects";
import { runtimeRouter } from "./routes/runtime";
import { shipRouter } from "./routes/ship";

export type AppDeps = {
  env: Env;
  db: Db;
  llm: LlmClient;
};

export type CreateAppOptions = {
  /** Mounts the client: Vite middleware in development, static files in production. */
  frontend?: (app: Express) => void;
};

/**
 * Builds the Express app without listening, so tests can drive it with supertest
 * and the dev/prod entry points can attach their own frontend handling.
 */
export function createApp(deps: AppDeps, options: CreateAppOptions = {}): Express {
  const { env } = deps;
  const app = express();
  const isProd = env.NODE_ENV === "production";

  app.disable("x-powered-by");
  // Replit (and most hosts) terminate TLS at a proxy; trust it for req.ip / req.protocol.
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(
    helmet({
      // Vite's dev server injects inline scripts, so the CSP is only enforced in production.
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              // CodeMirror injects <style> elements at runtime.
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https://avatars.githubusercontent.com"],
              frameSrc: ["'self'"],
              connectSrc: ["'self'"],
              // TLS is terminated by the host (Replit); upgrading would break plain-http localhost runs.
              upgradeInsecureRequests: null,
            },
          }
        : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // Generated apps: runtime bundles, sandboxed preview/published pages, and their data API.
  app.use(runtimeRouter());
  app.use(previewRouter(deps));
  app.use("/data", dataRouter(deps));

  // Session-cookie routes: resolve the user, reject cross-origin writes (CSRF), parse JSON.
  app.use("/api", loadUser(deps.db), originCheck, express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter(deps));
  app.use("/api/auth", authRouter(deps));
  app.use("/api/projects", projectsRouter(deps), generateRouter(deps), shipRouter(deps));
  app.use("/api/github", githubRouter(deps));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found", message: "Unknown API route" });
  });

  options.frontend?.(app);

  app.use(errorHandler);
  return app;
}
