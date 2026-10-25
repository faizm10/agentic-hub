import { authed } from "@/lib/server/guard";
import { json, route } from "@/lib/server/http";
import { keyStatus } from "@/lib/server/keys";

/** Which model APIs have a key on this account. Keys themselves are never returned. */
export const GET = route(async (request: Request) => {
  const { db, user } = await authed(request);
  return json({ providers: await keyStatus(db, user.id) });
});
