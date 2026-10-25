import { deleteChat, getChat } from "@/lib/server/chats";
import { authed } from "@/lib/server/guard";
import { HttpError, json, route } from "@/lib/server/http";

const UUID = /^[0-9a-f-]{36}$/;

export const GET = route(async (request: Request, ctx: RouteContext<"/api/chats/[id]">) => {
  const { db, user } = await authed(request);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError(404, "NOT_FOUND", "Chat not found");
  const after = Number(new URL(request.url).searchParams.get("after") ?? -1);
  return json(await getChat(db, user.id, id, Number.isSafeInteger(after) ? after : -1));
});

export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/chats/[id]">) => {
  const { db, user } = await authed(request);
  await deleteChat(db, user.id, (await ctx.params).id);
  return json({ ok: true });
});
