import { authed } from "@/lib/server/guard";
import { json, route } from "@/lib/server/http";
import { listDevices } from "@/lib/server/devices";

export const GET = route(async (request: Request) => {
  const { db, user } = await authed(request);
  return json({ devices: await listDevices(db, user.id) });
});
