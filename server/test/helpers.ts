import type { Express } from "express";
import request from "supertest";
import { createApp } from "../src/app";
import { createDb } from "../src/db/client";
import { loadEnv } from "../src/env";

/** A fresh app wired to the test database. Call `pool.end()` in afterAll. */
export function setupTestApp() {
  // A copy of process.env, so loadEnv doesn't read the developer's .env file.
  const env = loadEnv({ ...process.env });
  const { db, pool } = createDb(env.DATABASE_URL);
  const app = createApp({ env, db });
  return { env, db, pool, app };
}

let counter = 0;
/** Unique, valid username (lowercase, <= 24 chars) so test files never collide. */
export function uniqueName(prefix = "u"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`.slice(0, 24);
}

export const PASSWORD = "correct-horse-battery";

/** A supertest agent (keeps cookies) signed in as a newly registered user. */
export async function registeredAgent(app: Express, username = uniqueName()) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ username, password: PASSWORD }).expect(201);
  return { agent, username, userId: res.body.user.id as number };
}
