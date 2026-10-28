import { UsageReportSchema, type DeviceSnapshot, type UsageReport } from "@agentic-hub/types";
import { webChatUsage } from "@/lib/server/chats";
import { decryptJson } from "@/lib/server/crypto";
import { authed } from "@/lib/server/guard";
import { errorResponse, json } from "@/lib/server/http";

/** Usage from web chats plus the latest report each paired computer synced. */
export async function GET(request: Request) {
  try {
    const { db, user } = await authed(request);
    const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days")) || 30, 1), 365);
    const reports: UsageReport[] = [await webChatUsage(db, user.id, days)];
    const devices = await db.query<{ name: string; snapshot_enc: string | null }>("SELECT name, snapshot_enc FROM devices WHERE user_id = $1", [user.id]);
    for (const device of devices) {
      if (!device.snapshot_enc) continue;
      const parsed = UsageReportSchema.safeParse(decryptJson<DeviceSnapshot>(device.snapshot_enc).usage);
      if (parsed.success) reports.push({ ...parsed.data, source: device.name });
    }
    return json({ reports });
  } catch (error) {
    return errorResponse(error);
  }
}
