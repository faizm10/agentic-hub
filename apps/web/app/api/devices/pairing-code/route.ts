import { rateLimit } from "@/lib/server/auth";
import { createPairingCode } from "@/lib/server/devices";
import { authed } from "@/lib/server/guard";
import { json, route } from "@/lib/server/http";

export const POST = route(async (request: Request) => {
  const { db, user } = await authed(request);
  await rateLimit(db, `pairing:${user.id}`, 20, 3600);
  return json(await createPairingCode(db, user.id), { status: 201 });
});
