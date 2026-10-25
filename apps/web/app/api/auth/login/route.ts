import { cookies } from "next/headers";
import { CredentialsSchema, rateLimit, sessionCookie, startSession, verifyLogin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { assertSameOrigin, json, readJson, route } from "@/lib/server/http";
import { z } from "zod";

const LoginSchema = CredentialsSchema.extend({ password: z.string().min(1, "Enter your password").max(200) });

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const db = await getDb();
  const { email, password } = LoginSchema.parse(await readJson(request));
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await rateLimit(db, `login:${email}`, 8, 900);
  await rateLimit(db, `login-ip:${ip}`, 30, 900);
  const user = await verifyLogin(db, email, password);
  const { token, expires } = await startSession(db, user.id);
  (await cookies()).set(sessionCookie(request, token, expires));
  return json({ user });
});
