import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

/**
 * Applies committed SQL migrations from server/drizzle on boot. This keeps Replit's separate
 * development and production databases in sync without a manual migration step.
 */
export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "server/drizzle") });
}
