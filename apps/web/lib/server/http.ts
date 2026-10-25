import "server-only";
import { ZodError } from "zod";
import { ConfigError } from "./db";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const json = (value: unknown, init: ResponseInit = {}) =>
  Response.json(value, { ...init, headers: { "cache-control": "no-store", ...init.headers } });

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof ZodError) return json({ error: { code: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "Invalid request" } }, { status: 400 });
  if (error instanceof ConfigError) return json({ error: { code: "NOT_CONFIGURED", message: error.message } }, { status: 503 });
  console.error(error);
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side." } }, { status: 500 });
}

/** Wraps a route handler so thrown errors become `{ error }` JSON responses. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Cookie-authenticated mutations must come from this site. SameSite=Lax
 * already blocks cross-site POSTs with cookies; this rejects anything whose
 * Origin doesn't match as well.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "FORBIDDEN", "Missing origin");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "FORBIDDEN", "Invalid origin");
  }
  if (originHost !== host) throw new HttpError(403, "FORBIDDEN", "Cross-site request rejected");
}

export async function readJson(request: Request, limit = 2_000_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "TOO_LARGE", "Request body is too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid JSON body");
  }
}
