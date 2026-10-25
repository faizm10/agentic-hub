import { removeDevice } from "@/lib/server/devices";
import { authed } from "@/lib/server/guard";
import { json, route } from "@/lib/server/http";

/** Revokes the device: its token stops working on the next sync. */
export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/devices/[id]">) => {
  const { db, user } = await authed(request);
  await removeDevice(db, user.id, (await ctx.params).id);
  return json({ ok: true });
});
