import { sql } from "drizzle-orm";
import { Router } from "express";
import type { AppDeps } from "../app";

export function healthRouter({ db, env }: AppDeps) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const started = Date.now();
    await db.execute(sql`select 1`);
    res.json({ ok: true, db: true, llm: env.llmProvider, latencyMs: Date.now() - started });
  });

  return router;
}
