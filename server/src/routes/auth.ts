import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { MeResponse, UserDTO } from "@shared/api";
import type { AppDeps } from "../app";
import { currentUser, requireAuth } from "../auth/middleware";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  setSessionCookie,
  type SessionUser,
} from "../auth/sessions";
import { isUniqueViolation } from "../db/errors";
import { users } from "../db/schema";
import { HttpError } from "../lib/http";
import { getUsage } from "../lib/quota";
import { randomId } from "../lib/random";

const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "Use 3-24 characters: letters, numbers or underscore")
  .refine((u) => !u.startsWith("guest_"), "Usernames starting with guest_ are reserved");

const Credentials = z.object({
  username: Username,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const LoginBody = z.object({
  username: z.string().trim().toLowerCase().max(64),
  password: z.string().max(200),
});

const toUserDTO = (u: SessionUser): UserDTO => ({
  id: u.id,
  username: u.username,
  isGuest: u.isGuest,
  githubLogin: u.githubLogin,
});

// Verifying against a dummy hash keeps "unknown user" and "wrong password" equally slow.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password"));

export function authRouter({ db, env }: AppDeps) {
  const router = Router();
  const tooMany = (message: string) => (_req: Request, _res: Response, next: (err: unknown) => void) =>
    next(new HttpError(429, "rate_limited", message));
  const skip = () => env.NODE_ENV === "test";

  const attemptLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: env.AUTH_ATTEMPTS_PER_15MIN,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip,
    handler: tooMany("Too many attempts. Try again in a few minutes."),
  });
  const guestLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: env.GUEST_SIGNUPS_PER_HOUR,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip,
    handler: tooMany("Too many guest sessions from this network. Create an account instead."),
  });

  async function startSession(req: Request, res: Response, userId: number) {
    const { token, expiresAt } = await createSession(db, userId);
    setSessionCookie(req, res, token, expiresAt);
  }

  router.get("/me", async (req, res) => {
    const features = {
      llm: env.llmProvider,
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    };
    const body: MeResponse = req.user
      ? { user: toUserDTO(req.user), usage: await getUsage(db, env, req.user), features }
      : { user: null, usage: null, features };
    res.json(body);
  });

  router.post("/register", attemptLimiter, async (req, res) => {
    const { username, password } = Credentials.parse(req.body);
    const passwordHash = await hashPassword(password);
    try {
      const [user] = await db.insert(users).values({ username, passwordHash }).returning();
      await startSession(req, res, user!.id);
      res.status(201).json({ user: toUserDTO(user!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "username_taken", "That username is taken");
      throw err;
    }
  });

  router.post("/login", attemptLimiter, async (req, res) => {
    const { username, password } = LoginBody.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !user.passwordHash || !valid) {
      throw new HttpError(401, "invalid_credentials", "Wrong username or password");
    }
    await startSession(req, res, user.id);
    res.json({ user: toUserDTO(user) });
  });

  router.post("/guest", guestLimiter, async (req, res) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [user] = await db
          .insert(users)
          .values({ username: `guest_${randomId(6)}`, isGuest: true })
          .returning();
        await startSession(req, res, user!.id);
        res.status(201).json({ user: toUserDTO(user!) });
        return;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new HttpError(503, "guest_unavailable", "Could not create a guest session, please retry");
  });

  router.post("/logout", async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string") await deleteSession(db, token);
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  /** Turns the current guest account (and its projects) into a regular account. */
  router.post("/upgrade", requireAuth, attemptLimiter, async (req, res) => {
    const user = currentUser(req);
    if (!user.isGuest) throw new HttpError(400, "not_guest", "Only guest accounts can be upgraded");
    const { username, password } = Credentials.parse(req.body);
    try {
      const [updated] = await db
        .update(users)
        .set({ username, passwordHash: await hashPassword(password), isGuest: false })
        .where(eq(users.id, user.id))
        .returning();
      res.json({ user: toUserDTO(updated!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "username_taken", "That username is taken");
      throw err;
    }
  });

  return router;
}
