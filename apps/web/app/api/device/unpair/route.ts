import { getDb } from "@/lib/server/db";
import { unpairDevice } from "@/lib/server/devices";
import { json, route } from "@/lib/server/http";

export const POST = route(async (request: Request) => {
  await unpairDevice(await getDb(), request);
  return json({ ok: true });
});
