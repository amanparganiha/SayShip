import type { ApiErrorBody } from "@shared/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

/** fetch wrapper: JSON in/out, throws ApiError with the server's error code and message. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const body = data as Partial<ApiErrorBody> | undefined;
    throw new ApiError(res.status, body?.error ?? "http_error", body?.message ?? res.statusText, body?.details);
  }
  return data as T;
}

/** Human-readable message for any thrown value; surfaces the first zod issue for 400s. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "invalid_request" && Array.isArray(err.details) && err.details.length > 0) {
      const first = err.details[0] as { message?: string };
      if (first.message) return first.message;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
