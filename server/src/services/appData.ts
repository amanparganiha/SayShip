import { and, count, countDistinct, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { appRecords, projects, type AppRecord } from "../db/schema";
import { HttpError, notFound } from "../lib/http";

export type AppEnv = "preview" | "live";
export type AppScope = { projectId: number; env: AppEnv };

export const COLLECTION_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const DATA_LIMITS = { recordsPerCollection: 1000, collectionsPerEnv: 20, bodyBytes: "16kb" } as const;
const RESERVED_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

/**
 * A capability key identifies one app's data: the preview key (shown only to the owner) or the
 * live key (embedded in the published page; valid only while the project is published).
 */
export async function resolveAppKey(db: Db, key: string): Promise<AppScope | null> {
  const [p] = await db
    .select({
      id: projects.id,
      previewKey: projects.previewKey,
      publishedVersion: projects.publishedVersion,
    })
    .from(projects)
    .where(or(eq(projects.previewKey, key), eq(projects.liveKey, key)))
    .limit(1);
  if (!p) return null;
  if (p.previewKey === key) return { projectId: p.id, env: "preview" };
  return p.publishedVersion === null ? null : { projectId: p.id, env: "live" };
}

export function checkCollection(name: unknown): string {
  if (typeof name !== "string" || !COLLECTION_RE.test(name)) {
    throw new HttpError(400, "invalid_collection", "Collection names are lowercase letters, digits and _ (max 40)");
  }
  return name;
}

/** Accepts only a plain JSON object and drops the fields the server owns. */
export function cleanFields(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "invalid_record", "Records must be JSON objects");
  }
  return Object.fromEntries(Object.entries(body).filter(([k]) => !RESERVED_FIELDS.has(k)));
}

export type RecordDTO = Record<string, unknown> & { id: number; createdAt: string; updatedAt: string };

export const toRecordDTO = (r: AppRecord): RecordDTO => ({
  ...r.data,
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const inScope = (scope: AppScope, collection: string) =>
  and(
    eq(appRecords.projectId, scope.projectId),
    eq(appRecords.env, scope.env),
    eq(appRecords.collection, collection),
  );

export async function listRecords(db: Db, scope: AppScope, collection: string): Promise<RecordDTO[]> {
  const rows = await db
    .select()
    .from(appRecords)
    .where(inScope(scope, collection))
    .orderBy(appRecords.id)
    .limit(DATA_LIMITS.recordsPerCollection);
  return rows.map(toRecordDTO);
}

export async function createRecord(db: Db, scope: AppScope, collection: string, data: Record<string, unknown>) {
  const [{ n }] = (await db.select({ n: count() }).from(appRecords).where(inScope(scope, collection))) as [
    { n: number },
  ];
  if (n >= DATA_LIMITS.recordsPerCollection) {
    throw new HttpError(409, "collection_full", `A collection can hold at most ${DATA_LIMITS.recordsPerCollection} records`);
  }
  if (n === 0) {
    const [{ c }] = (await db
      .select({ c: countDistinct(appRecords.collection) })
      .from(appRecords)
      .where(and(eq(appRecords.projectId, scope.projectId), eq(appRecords.env, scope.env)))) as [{ c: number }];
    if (c >= DATA_LIMITS.collectionsPerEnv) {
      throw new HttpError(409, "too_many_collections", `An app can have at most ${DATA_LIMITS.collectionsPerEnv} collections`);
    }
  }
  const [row] = await db
    .insert(appRecords)
    .values({ projectId: scope.projectId, env: scope.env, collection, data })
    .returning();
  return toRecordDTO(row!);
}

export async function updateRecord(
  db: Db,
  scope: AppScope,
  collection: string,
  id: number,
  patch: Record<string, unknown>,
) {
  const [row] = await db
    .update(appRecords)
    // Shallow merge in Postgres: existing fields survive unless the patch overwrites them.
    .set({ data: sql`${appRecords.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(and(inScope(scope, collection), eq(appRecords.id, id)))
    .returning();
  if (!row) throw notFound("Record");
  return toRecordDTO(row);
}

export async function deleteRecord(db: Db, scope: AppScope, collection: string, id: number) {
  const deleted = await db
    .delete(appRecords)
    .where(and(inScope(scope, collection), eq(appRecords.id, id)))
    .returning({ id: appRecords.id });
  if (deleted.length === 0) throw notFound("Record");
}

export type CollectionSummary = { name: string; count: number; records: RecordDTO[] };

/** Owner view for the workspace Data panel: every collection with its newest records. */
export async function summarizeData(db: Db, projectId: number, env: AppEnv): Promise<CollectionSummary[]> {
  const counts = await db
    .select({ name: appRecords.collection, count: count() })
    .from(appRecords)
    .where(and(eq(appRecords.projectId, projectId), eq(appRecords.env, env)))
    .groupBy(appRecords.collection)
    .orderBy(appRecords.collection);

  return Promise.all(
    counts.map(async ({ name, count }) => {
      const rows = await db
        .select()
        .from(appRecords)
        .where(inScope({ projectId, env }, name))
        .orderBy(desc(appRecords.id))
        .limit(50);
      return { name, count, records: rows.map(toRecordDTO) };
    }),
  );
}

export async function resetData(db: Db, projectId: number, env: AppEnv) {
  await db.delete(appRecords).where(and(eq(appRecords.projectId, projectId), eq(appRecords.env, env)));
}
