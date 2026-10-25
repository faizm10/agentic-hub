import { DeviceCommandSchema } from "@agentic-hub/types";
import { queueCommand } from "@/lib/server/devices";
import { authed } from "@/lib/server/guard";
import { json, readJson, route } from "@/lib/server/http";

export const POST = route(async (request: Request, ctx: RouteContext<"/api/devices/[id]/commands">) => {
  const { db, user } = await authed(request);
  const command = DeviceCommandSchema.parse(await readJson(request));
  return json(await queueCommand(db, user.id, (await ctx.params).id, command), { status: 202 });
});
