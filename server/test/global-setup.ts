import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { TEST_DATABASE_URL } from "./testEnv";

/** Runs once before all test files: bring the test database to the latest schema and empty it. */
export default async function setup() {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "server/drizzle" });
    await pool.query(
      "TRUNCATE users, sessions, projects, generations, usage_events, app_records RESTART IDENTITY CASCADE",
    );
  } finally {
    await pool.end();
  }
}
