import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Db } from "../db/client";
import { HttpError } from "../lib/http";
import { findSessionUser, SESSION_COOKIE, type SessionUser } from "./sessions";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** Attaches req.user when the session cookie is valid. Never rejects on its own. */
export function loadUser(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0) {
      req.user = (await findSessionUser(db, token)) ?? undefined;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "unauthorized", "Sign in required"));
  next();
};

/** Narrows req.user after requireAuth has run. */
export function currentUser(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, "unauthorized", "Sign in required");
  return req.user;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated routes: browsers always send Origin on non-GET requests,
 * so a mismatched Origin (including "null" from sandboxed generated apps) is rejected.
 * Requests without Origin come from non-browser clients, which carry no ambient cookies.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (origin === undefined) return next();

  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost !== null && originHost === req.host) return next();
  next(new HttpError(403, "bad_origin", "Cross-origin request blocked"));
}
