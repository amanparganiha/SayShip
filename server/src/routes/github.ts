import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type Request } from "express";
import type { AppDeps } from "../app";
import { encryptSecret } from "../auth/crypto";
import { currentUser, requireAuth } from "../auth/middleware";
import { users } from "../db/schema";
import { exchangeCode } from "../export/github";
import { HttpError } from "../lib/http";

const STATE_COOKIE = "ps_gh_oauth";
const RETURN_TO_RE = /^\/projects\/\d+$/;

/**
 * "Connect GitHub" (OAuth web flow, public_repo scope). Only enabled when the server has a
 * GitHub OAuth app configured; the callback URL is $APP_URL/api/github/callback.
 */
export function githubRouter({ db, env }: AppDeps) {
  const router = Router();
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  const callbackUrl = (req: Request) => `${env.APP_URL ?? `${req.protocol}://${req.host}`}/api/github/callback`;

  router.use((_req, _res, next) => {
    if (clientId && clientSecret) return next();
    next(new HttpError(404, "github_disabled", "GitHub export isn't configured on this server."));
  });
  router.use(requireAuth);

  router.get("/connect", (req, res) => {
    const returnTo = typeof req.query.returnTo === "string" && RETURN_TO_RE.test(req.query.returnTo) ? req.query.returnTo : "/";
    const state = randomBytes(16).toString("base64url");
    // The state ties the callback to this browser (CSRF protection for the OAuth flow).
    res.cookie(STATE_COOKIE, JSON.stringify({ state, returnTo }), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: 10 * 60_000,
      path: "/api/github",
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId!);
    url.searchParams.set("redirect_uri", callbackUrl(req));
    url.searchParams.set("scope", "public_repo");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  router.get("/callback", async (req, res) => {
    let saved: { state?: string; returnTo?: string } = {};
    try {
      saved = JSON.parse(String(req.cookies?.[STATE_COOKIE] ?? "{}"));
    } catch {
      saved = {};
    }
    res.clearCookie(STATE_COOKIE, { path: "/api/github" });
    const returnTo = saved.returnTo && RETURN_TO_RE.test(saved.returnTo) ? saved.returnTo : "/";

    try {
      if (!saved.state || req.query.state !== saved.state || typeof req.query.code !== "string") {
        throw new HttpError(400, "github_state", "GitHub sign-in expired. Please try again.");
      }
      const { token, login } = await exchangeCode({
        clientId: clientId!,
        clientSecret: clientSecret!,
        code: req.query.code,
        redirectUri: callbackUrl(req),
      });
      await db
        .update(users)
        .set({ githubLogin: login, githubTokenEnc: encryptSecret(token, env.SESSION_SECRET) })
        .where(eq(users.id, currentUser(req).id));
      res.redirect(`${returnTo}?github=connected`);
    } catch (err) {
      const message = err instanceof HttpError ? err.message : "GitHub sign-in failed.";
      if (!(err instanceof HttpError)) console.error("[github] callback failed", err);
      res.redirect(`${returnTo}?github=error&message=${encodeURIComponent(message)}`);
    }
  });

  router.delete("/", async (req, res) => {
    await db.update(users).set({ githubLogin: null, githubTokenEnc: null }).where(eq(users.id, currentUser(req).id));
    res.status(204).end();
  });

  return router;
}
