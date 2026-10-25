import { cookies } from "next/headers";
import { endSession, SESSION_COOKIE } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { assertSameOrigin, json, route } from "@/lib/server/http";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const store = await cookies();
  await endSession(await getDb(), store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  return json({ ok: true });
});
