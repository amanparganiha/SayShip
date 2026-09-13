import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate";
import { TEST_DATABASE_URL } from "./testEnv";

/** A throwaway database per run, so these tests can start from nothing. */
const name = `sayship_migrate_${randomBytes(4).toString("hex")}`;
const url = new URL(TEST_DATABASE_URL);
url.pathname = `/${name}`;
const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const pools: pg.Pool[] = [];
const newPool = () => {
  const pool = new pg.Pool({ connectionString: url.toString() });
  pools.push(pool);
  return pool;
};

beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
});
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

async function tables(pool: pg.Pool): Promise<string[]> {
  const res = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  return res.rows.map((r) => r.table_name);
}

describe("boot-time migrations", () => {
  it("apply once when several Autoscale instances boot at the same moment", async () => {
    await Promise.all([runMigrations(newPool()), runMigrations(newPool()), runMigrations(newPool())]);

    const pool = newPool();
    expect(await tables(pool)).toEqual(["app_records", "generations", "projects", "sessions", "usage_events", "users"]);
    const applied = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(applied.rows[0].n).toBe(1);
  });

  it("tolerate existing tables without migration history (e.g. production seeded from dev data)", async () => {
    const pool = newPool();
    await pool.query("DROP SCHEMA drizzle CASCADE");
    await runMigrations(pool);
    expect(await tables(pool)).toHaveLength(6);
    const applied = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(applied.rows[0].n).toBe(1);
  });
});
