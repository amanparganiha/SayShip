import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/** An error with an HTTP status and a stable machine-readable code, rendered as JSON. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_request", message: "Invalid request", details: err.issues });
    return;
  }
  // Errors raised by express.json()
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "payload_too_large", message: "Request body is too large" });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid_json", message: "Request body is not valid JSON" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "internal", message: "Something went wrong" });
};
