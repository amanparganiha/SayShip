import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { usageEvents } from "../db/schema";
import type { Env } from "../env";
import type { SessionUser } from "../auth/sessions";

export type Usage = { used: number; limit: number; remaining: number };

/**
 * Runs by everyone in the last 24h. Per-user and per-IP limits can be sidestepped (new accounts,
 * proxies), so this global ceiling is what actually bounds the model bill of a public deployment.
 */
export async function globalRunsToday(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(gt(usageEvents.createdAt, sql`now() - interval '24 hours'`));
  return row?.count ?? 0;
}

/** Generation runs in the last 24h. Guests get a smaller budget: it protects the OpenAI key. */
export async function getUsage(db: Db, env: Env, user: SessionUser): Promise<Usage> {
  const limit = user.isGuest ? env.GUEST_DAILY_RUN_LIMIT : env.DAILY_RUN_LIMIT;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, user.id), gt(usageEvents.createdAt, sql`now() - interval '24 hours'`)));
  const used = row?.count ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}
