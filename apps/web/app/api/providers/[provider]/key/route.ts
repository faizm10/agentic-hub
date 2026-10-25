import { z } from "zod";
import { authed } from "@/lib/server/guard";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { deleteKey, isApiProvider, saveKey } from "@/lib/server/keys";

const BodySchema = z.object({ apiKey: z.string().trim().min(8, "That doesn't look like an API key").max(500) });

function provider(raw: string) {
  if (!isApiProvider(raw)) throw new HttpError(404, "NOT_FOUND", "Unknown provider");
  return raw;
}

export const PUT = route(async (request: Request, ctx: RouteContext<"/api/providers/[provider]/key">) => {
  const { db, user } = await authed(request);
  const id = provider((await ctx.params).provider);
  const { apiKey } = BodySchema.parse(await readJson(request));
  return json(await saveKey(db, user.id, id, apiKey));
});

export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/providers/[provider]/key">) => {
  const { db, user } = await authed(request);
  await deleteKey(db, user.id, provider((await ctx.params).provider));
  return json({ ok: true });
});
