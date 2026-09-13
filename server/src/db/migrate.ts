import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";

/** Arbitrary constant identifying SayShip's migration lock in pg_advisory_lock. */
const MIGRATION_LOCK_ID = 7_202_609;

/**
 * Applies committed SQL migrations from server/drizzle on boot, which keeps Replit's separate
 * development and production databases in sync without a manual step.
 *
 * Autoscale can start several instances at once, so migrations are serialized with a Postgres
 * advisory lock. The lock belongs to a database session, so lock, migrate and unlock must all use
 * one dedicated connection (a pool could hand each query a different one).
 */
export async function runMigrations(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client }), { migrationsFolder: path.resolve(process.cwd(), "server/drizzle") });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
