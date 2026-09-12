import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Request, Response } from "express";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "ps_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: number;
  username: string;
  isGuest: boolean;
  githubLogin: string | null;
};

/** Only the sha256 of the token is stored, so a leaked sessions table can't be replayed. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // Opportunistic cleanup keeps the table small without a cron job.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function findSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      isGuest: users.isGuest,
      githubLogin: users.githubLogin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function setSessionCookie(req: Request, res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // req.secure honours X-Forwarded-Proto from the (trusted) Replit proxy.
    secure: req.secure,
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/" });
}
