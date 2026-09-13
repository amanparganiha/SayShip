import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

/**
 * TLS settings for a connection string. pg reads `sslmode` from the URL itself; the only extra
 * case is a Neon host without it (Replit production databases run on Neon and require TLS).
 * Replit's development database runs next to the app and doesn't use TLS.
 */
export function sslFor(connectionString: string): pg.PoolConfig["ssl"] {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.has("sslmode")) return undefined;
    if (url.hostname.endsWith(".neon.tech")) return true;
  } catch {
    // Not a URL (e.g. a key=value DSN): leave TLS to pg's own parsing.
  }
  return undefined;
}

export function createDb(connectionString: string) {
  const ssl = sslFor(connectionString);
  const pool = new pg.Pool({ connectionString, max: 10, ...(ssl ? { ssl } : {}) });
  // An idle connection can be closed by the server at any time (Neon, which hosts Replit's
  // production databases, does so when it scales to zero). pg reports that as an 'error' event;
  // without a listener Node treats it as uncaught and the whole server exits. The pool drops the
  // dead client and opens a fresh one on the next query.
  pool.on("error", (err) => console.warn(`[db] idle connection closed: ${err.message}`));
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
