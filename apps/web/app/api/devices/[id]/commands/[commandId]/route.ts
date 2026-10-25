import { commandStatus } from "@/lib/server/devices";
import { authed } from "@/lib/server/guard";
import { json, route } from "@/lib/server/http";

export const GET = route(async (request: Request, ctx: RouteContext<"/api/devices/[id]/commands/[commandId]">) => {
  const { db, user } = await authed(request);
  const { id, commandId } = await ctx.params;
  return json(await commandStatus(db, user.id, id, commandId));
});
