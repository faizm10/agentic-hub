import "server-only";
import { requireUser, type User } from "./auth";
import { getDb, type Db } from "./db";
import { assertSameOrigin } from "./http";

/** Signed-in user plus the database; mutating methods must also be same-origin. */
export async function authed(request: Request): Promise<{ db: Db; user: User }> {
  if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
  const user = await requireUser();
  return { db: await getDb(), user };
}
