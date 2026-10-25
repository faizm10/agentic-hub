import { getDb } from "@/lib/server/db";
import { pairDevice, PairRequestSchema } from "@/lib/server/devices";
import { rateLimit } from "@/lib/server/auth";
import { json, readJson, route } from "@/lib/server/http";

/** Called by a desktop runtime with a short-lived code the signed-in user created. */
export const POST = route(async (request: Request) => {
  const db = await getDb();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await rateLimit(db, `device-pair:${ip}`, 20, 900);
  return json(await pairDevice(db, PairRequestSchema.parse(await readJson(request, 10_000))), { status: 201 });
});
