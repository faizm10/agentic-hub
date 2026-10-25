import { deviceSessionEvents } from "@/lib/server/devices";
import { authed } from "@/lib/server/guard";
import { HttpError, json, route } from "@/lib/server/http";

export const GET = route(async (request: Request, ctx: RouteContext<"/api/devices/[id]/sessions/[sessionId]">) => {
  const { db, user } = await authed(request);
  const { id, sessionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(sessionId)) throw new HttpError(404, "NOT_FOUND", "Session not found");
  const after = Number(new URL(request.url).searchParams.get("after") ?? -1);
  return json({ events: await deviceSessionEvents(db, user.id, id, sessionId, Number.isSafeInteger(after) ? after : -1) });
});
