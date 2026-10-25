import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { hashPassword, hashToken, newToken, verifyPassword } from "./crypto";
import { getDb, type Db } from "./db";
import { HttpError } from "./http";

export const SESSION_COOKIE = "ahub_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
}

export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z.string().min(10, "Use at least 10 characters for your password").max(200),
});

/** Optional allow-list for sign-ups: `AGENTIC_HUB_ALLOWED_EMAILS=me@example.com,@mycompany.com`. */
export function signupAllowed(email: string, raw = process.env.AGENTIC_HUB_ALLOWED_EMAILS): boolean {
  const rules = (raw ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  return rules.some((rule) => (rule.startsWith("@") ? email.endsWith(rule) : email === rule));
}

/** Fixed-window limiter in Postgres, so it holds across serverless instances. */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
  const [row] = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSeconds],
  );
  if ((row?.count ?? 0) > limit) throw new HttpError(429, "RATE_LIMITED", "Too many attempts. Wait a few minutes and try again.");
}

export async function createUser(db: Db, email: string, password: string): Promise<User> {
  if (!signupAllowed(email)) throw new HttpError(403, "SIGNUP_CLOSED", "Sign-ups are restricted on this deployment.");
  const id = randomUUID();
  const rows = await db.query<User>(
    "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email",
    [id, email, await hashPassword(password)],
  );
  if (!rows[0]) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
  return rows[0];
}

export async function verifyLogin(db: Db, email: string, password: string): Promise<User> {
  const [row] = await db.query<{ id: string; email: string; password_hash: string }>("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
  // Hash anyway when the user doesn't exist, so timing doesn't reveal accounts.
  const ok = await verifyPassword(password, row?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!row || !ok) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  return { id: row.id, email: row.email };
}

export async function startSession(db: Db, userId: string): Promise<{ token: string; expires: Date }> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hashToken(token), userId, expires]);
  await db.query("DELETE FROM auth_sessions WHERE user_id = $1 AND expires_at < now()", [userId]);
  return { token, expires };
}

export async function userForToken(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [row] = await db.query<User>(
    "SELECT u.id, u.email FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
    [hashToken(token)],
  );
  return row ?? null;
}

export async function endSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export function sessionCookie(request: Request, token: string, expires: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** The signed-in user for a server component or route handler, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForToken(await getDb(), token);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "Sign in to continue.");
  return user;
}
