import { authed } from "@/lib/server/guard";
import { HttpError, json, route } from "@/lib/server/http";
import { getKey, isApiProvider, listModels, providerError } from "@/lib/server/keys";

export const GET = route(async (request: Request, ctx: RouteContext<"/api/providers/[provider]/models">) => {
  const { db, user } = await authed(request);
  const id = (await ctx.params).provider;
  if (!isApiProvider(id)) throw new HttpError(404, "NOT_FOUND", "Unknown provider");
  const apiKey = await getKey(db, user.id, id);
  if (!apiKey) throw new HttpError(400, "NO_KEY", "Add an API key first.");
  try {
    return json({ models: await listModels(id, apiKey) }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    throw new HttpError(502, "PROVIDER_ERROR", providerError(error, id));
  }
});
