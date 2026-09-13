import { sql } from "drizzle-orm";
import { Router } from "express";
import type { AppDeps } from "../app";

export function healthRouter({ db, env }: AppDeps) {
  const router = Router();

  router.get("/", async (req, res) => {
    const started = Date.now();
    await db.execute(sql`select 1`);
    res.json({
      ok: true,
      db: true,
      llm: env.llmProvider,
      latencyMs: Date.now() - started,
      // Your own address as the server sees it: shows whether TRUST_PROXY_HOPS is right for the
      // host (per-IP rate limits depend on it).
      ip: req.ip,
    });
  });

  return router;
}
