import { cookies } from "next/headers";
import { createUser, CredentialsSchema, rateLimit, sessionCookie, startSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { assertSameOrigin, json, readJson, route } from "@/lib/server/http";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const db = await getDb();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await rateLimit(db, `signup:${ip}`, 10, 3600);
  const { email, password } = CredentialsSchema.parse(await readJson(request));
  const user = await createUser(db, email, password);
  const { token, expires } = await startSession(db, user.id);
  (await cookies()).set(sessionCookie(request, token, expires));
  return json({ user }, { status: 201 });
});
