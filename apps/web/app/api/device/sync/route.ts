import { getDb } from "@/lib/server/db";
import { syncDevice, SyncRequestSchema } from "@/lib/server/devices";
import { json, readJson, route } from "@/lib/server/http";

export const POST = route(async (request: Request) => {
  const db = await getDb();
  return json(await syncDevice(db, request, SyncRequestSchema.parse(await readJson(request, 4_400_000))));
});
