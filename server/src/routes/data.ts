import express, { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/http";
import {
  checkCollection,
  cleanFields,
  createRecord,
  DATA_LIMITS,
  deleteRecord,
  listRecords,
  resolveAppKey,
  updateRecord,
  type AppScope,
} from "../services/appData";

/**
 * The per-app backend generated apps talk to through the `promptship` SDK:
 *   GET/POST /data/:appKey/:collection   PATCH/DELETE /data/:appKey/:collection/:id
 *
 * Called from opaque-origin sandboxed pages, so it is CORS-open, never reads cookies, and is
 * authorised only by the unguessable app key.
 */
export function dataRouter({ db, env }: AppDeps) {
  const router = Router();
  const skip = () => env.NODE_ENV === "test";

  router.use((req, res, next) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      // helmet defaults CORP to same-origin, which would block sandboxed pages.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "no-store",
    });
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip,
      handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many requests")),
    }),
  );
  const writeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip,
    handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many writes, slow down")),
  });
  router.use(express.json({ limit: DATA_LIMITS.bodyBytes }));

  async function scopeOf(req: Request): Promise<AppScope> {
    const key = req.params.appKey;
    const scope = typeof key === "string" ? await resolveAppKey(db, key) : null;
    if (!scope) throw notFound("App");
    return scope;
  }

  const recordId = (raw: unknown) => {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Record");
    return id;
  };

  router.get("/:appKey/:collection", async (req, res) => {
    const scope = await scopeOf(req);
    res.json({ items: await listRecords(db, scope, checkCollection(req.params.collection)) });
  });

  router.post("/:appKey/:collection", writeLimiter, async (req, res) => {
    const scope = await scopeOf(req);
    const record = await createRecord(db, scope, checkCollection(req.params.collection), cleanFields(req.body));
    res.status(201).json(record);
  });

  router.patch("/:appKey/:collection/:id", writeLimiter, async (req, res) => {
    const scope = await scopeOf(req);
    const record = await updateRecord(
      db,
      scope,
      checkCollection(req.params.collection),
      recordId(req.params.id),
      cleanFields(req.body),
    );
    res.json(record);
  });

  router.delete("/:appKey/:collection/:id", writeLimiter, async (req, res) => {
    const scope = await scopeOf(req);
    await deleteRecord(db, scope, checkCollection(req.params.collection), recordId(req.params.id));
    res.status(204).end();
  });

  return router;
}
