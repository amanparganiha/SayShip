import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { projects } from "../db/schema";

const LEASE_MS = 10 * 60_000;

/**
 * One generation run per project at a time. An atomic conditional UPDATE works across
 * several server instances (Replit Autoscale), unlike an in-memory lock; the expiry means a
 * crashed instance can't block a project forever.
 */
export async function acquireRunLease(db: Db, projectId: number): Promise<boolean> {
  const rows = await db
    .update(projects)
    .set({ runLeaseUntil: sql`now() + ${`${LEASE_MS} milliseconds`}::interval` })
    .where(and(eq(projects.id, projectId), or(isNull(projects.runLeaseUntil), lt(projects.runLeaseUntil, sql`now()`))))
    .returning({ id: projects.id });
  return rows.length > 0;
}

export async function releaseRunLease(db: Db, projectId: number) {
  await db.update(projects).set({ runLeaseUntil: null }).where(eq(projects.id, projectId));
}
