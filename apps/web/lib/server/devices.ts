import "server-only";
import { randomUUID } from "node:crypto";
import { AgentEventSchema, DeviceCommandSchema, DeviceSnapshotSchema, type AgentEvent, type DeviceCommand, type DeviceSnapshot } from "@agentic-hub/types";
import { z } from "zod";
import { decryptJson, encryptJson, hashToken, newPairingCode, newToken } from "./crypto";
import type { Db } from "./db";
import { HttpError } from "./http";

/**
 * Control plane for paired desktop runtimes.
 *
 * Devices only ever call in (outbound HTTPS from the user's computer); the
 * server never connects to a device. Each device authenticates with its own
 * bearer token, stored here only as a SHA-256 hash. Commands from the web
 * are queued and picked up on the device's next sync; the device runs them
 * only if its owner turned on remote control on that computer.
 */

const PAIRING_TTL_MINUTES = 10;
/** A device that hasn't synced for this long is shown as offline. */
export const ONLINE_WINDOW_MS = 45_000;
const VIEWER_WINDOW_SECONDS = 90;
const COMMAND_TIMEOUT = "2 minutes";

export const PairRequestSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Enter the code shown in the web app"),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(["macos", "windows", "linux"]),
  runtimeVersion: z.string().max(40).optional(),
});

export const SyncRequestSchema = z.object({
  snapshot: DeviceSnapshotSchema,
  events: z.array(AgentEventSchema).max(1000),
  acks: z
    .array(z.object({ id: z.string().uuid(), ok: z.boolean(), error: z.string().max(2000).optional(), result: z.record(z.unknown()).optional() }))
    .max(200),
});

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  platform: "macos" | "windows" | "linux";
  runtime_version: string | null;
  snapshot_enc: string | null;
  allow_remote_control: boolean;
  last_seen_at: Date | null;
  created_at: Date;
}

export interface DeviceView {
  id: string;
  name: string;
  platform: DeviceRow["platform"];
  online: boolean;
  lastSeenAt: string | null;
  runtimeVersion: string | null;
  allowRemoteControl: boolean;
  snapshot: DeviceSnapshot | null;
}

function view(row: DeviceRow, now = Date.now()): DeviceView {
  const lastSeen = row.last_seen_at ? new Date(row.last_seen_at) : null;
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    online: Boolean(lastSeen && now - lastSeen.getTime() < ONLINE_WINDOW_MS),
    lastSeenAt: lastSeen?.toISOString() ?? null,
    runtimeVersion: row.runtime_version,
    allowRemoteControl: row.allow_remote_control,
    snapshot: row.snapshot_enc ? decryptJson<DeviceSnapshot>(row.snapshot_enc) : null,
  };
}

// ── Web side (cookie-authenticated user) ───────────────────────────────

export async function createPairingCode(db: Db, userId: string): Promise<{ code: string; expiresAt: string }> {
  await db.query("DELETE FROM pairing_codes WHERE user_id = $1 OR expires_at < now()", [userId]);
  const code = newPairingCode();
  const expires = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000);
  await db.query("INSERT INTO pairing_codes (code_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hashToken(code), userId, expires]);
  return { code, expiresAt: expires.toISOString() };
}

/** Lists the user's devices and marks them as watched, so they sync faster while someone is looking. */
export async function listDevices(db: Db, userId: string): Promise<DeviceView[]> {
  const rows = await db.query<DeviceRow>(
    `UPDATE devices SET viewer_until = now() + make_interval(secs => $2) WHERE user_id = $1 RETURNING *`,
    [userId, VIEWER_WINDOW_SECONDS],
  );
  return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((row) => view(row));
}

export async function deviceFor(db: Db, userId: string, deviceId: string): Promise<DeviceView> {
  const [row] = await db.query<DeviceRow>("SELECT * FROM devices WHERE id = $1 AND user_id = $2", [deviceId, userId]);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Device not found");
  return view(row);
}

export async function removeDevice(db: Db, userId: string, deviceId: string) {
  await db.query("DELETE FROM devices WHERE id = $1 AND user_id = $2", [deviceId, userId]);
}

export async function deviceSessionEvents(db: Db, userId: string, deviceId: string, sessionId: string, after = -1): Promise<AgentEvent[]> {
  await deviceFor(db, userId, deviceId);
  const rows = await db.query<{ payload_enc: string }>(
    "SELECT payload_enc FROM device_events WHERE device_id = $1 AND session_id = $2 AND sequence > $3 ORDER BY sequence LIMIT 2000",
    [deviceId, sessionId, after],
  );
  return rows.map((r) => decryptJson<AgentEvent>(r.payload_enc));
}

/** Queues a command. The device must be online and have remote control turned on. */
export async function queueCommand(db: Db, userId: string, deviceId: string, command: DeviceCommand): Promise<{ id: string }> {
  const device = await deviceFor(db, userId, deviceId);
  if (!device.allowRemoteControl) throw new HttpError(403, "REMOTE_CONTROL_OFF", `Control from the web is turned off on ${device.name}. Turn it on in the desktop app under Settings → Web access.`);
  if (!device.online) throw new HttpError(409, "DEVICE_OFFLINE", `${device.name} is offline. Open Agentic Hub on that computer and try again.`);
  const id = randomUUID();
  await db.query("INSERT INTO device_commands (id, device_id, command_enc, status) VALUES ($1, $2, $3, 'pending')", [id, deviceId, encryptJson(DeviceCommandSchema.parse(command))]);
  await db.query("UPDATE devices SET viewer_until = now() + make_interval(secs => $2) WHERE id = $1", [deviceId, VIEWER_WINDOW_SECONDS]);
  return { id };
}

export async function commandStatus(db: Db, userId: string, deviceId: string, commandId: string) {
  await deviceFor(db, userId, deviceId);
  const [row] = await db.query<{ status: string; error: string | null; result: Record<string, unknown> | null }>(
    "SELECT status, error, result FROM device_commands WHERE id = $1 AND device_id = $2",
    [commandId, deviceId],
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "Command not found");
  // Drivers differ in whether jsonb comes back parsed.
  const result = typeof row.result === "string" ? (JSON.parse(row.result) as Record<string, unknown>) : row.result;
  return { ...row, result };
}

// ── Device side (bearer device token) ──────────────────────────────────

export async function pairDevice(db: Db, input: z.infer<typeof PairRequestSchema>): Promise<{ deviceId: string; deviceToken: string }> {
  const [code] = await db.query<{ user_id: string }>("DELETE FROM pairing_codes WHERE code_hash = $1 AND expires_at > now() RETURNING user_id", [hashToken(input.code)]);
  if (!code) throw new HttpError(400, "INVALID_CODE", "That pairing code is invalid or has expired. Create a new one in the web app.");
  const deviceId = randomUUID();
  const deviceToken = newToken(32);
  await db.query(
    "INSERT INTO devices (id, user_id, name, platform, token_hash, runtime_version, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
    [deviceId, code.user_id, input.name, input.platform, hashToken(deviceToken), input.runtimeVersion ?? null],
  );
  return { deviceId, deviceToken };
}

export async function authenticateDevice(db: Db, request: Request): Promise<DeviceRow & { viewer_until: Date | null }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "UNAUTHORIZED", "Device token required");
  const [row] = await db.query<DeviceRow & { viewer_until: Date | null }>("SELECT * FROM devices WHERE token_hash = $1", [hashToken(token)]);
  if (!row) throw new HttpError(401, "UNAUTHORIZED", "Unknown or revoked device");
  return row;
}

export async function unpairDevice(db: Db, request: Request) {
  const device = await authenticateDevice(db, request);
  await db.query("DELETE FROM devices WHERE id = $1", [device.id]);
}

/**
 * One device round trip: store the snapshot and new events, settle acked
 * commands, and hand out pending ones. Returns how soon to sync again.
 */
export async function syncDevice(db: Db, request: Request, body: z.infer<typeof SyncRequestSchema>) {
  const device = await authenticateDevice(db, request);
  const knownSessions = new Set(body.snapshot.sessions.map((s) => s.id));
  await db.query(
    "UPDATE devices SET snapshot_enc = $2, runtime_version = $3, allow_remote_control = $4, platform = $5, last_seen_at = now() WHERE id = $1",
    [device.id, encryptJson(body.snapshot), body.snapshot.runtimeVersion, body.snapshot.allowRemoteControl, body.snapshot.platform],
  );
  for (const event of body.events) {
    if (!knownSessions.has(event.sessionId)) continue;
    await db.query(
      "INSERT INTO device_events (device_id, session_id, sequence, payload_enc) VALUES ($1, $2, $3, $4) ON CONFLICT (device_id, session_id, sequence) DO UPDATE SET payload_enc = excluded.payload_enc",
      [device.id, event.sessionId, event.sequence, encryptJson(event)],
    );
  }
  for (const ack of body.acks) {
    await db.query(
      "UPDATE device_commands SET status = $3, error = $4, result = $5::text::jsonb, done_at = now() WHERE id = $1 AND device_id = $2 AND status IN ('pending', 'sent')",
      [ack.id, device.id, ack.ok ? "done" : "failed", ack.error ?? null, ack.result ? JSON.stringify(ack.result) : null],
    );
  }
  // Commands nobody picked up in time fail rather than run much later.
  await db.query(`UPDATE device_commands SET status = 'failed', error = 'The device did not respond in time.', done_at = now() WHERE device_id = $1 AND status IN ('pending', 'sent') AND created_at < now() - interval '${COMMAND_TIMEOUT}'`, [device.id]);
  const pending = await db.query<{ id: string; command_enc: string }>(
    "UPDATE device_commands SET status = 'sent', sent_at = now() WHERE device_id = $1 AND status = 'pending' RETURNING id, command_enc",
    [device.id],
  );
  const watched = device.viewer_until ? new Date(device.viewer_until).getTime() > Date.now() : false;
  return {
    commands: pending.map((row) => ({ id: row.id, command: decryptJson<DeviceCommand>(row.command_enc) })),
    nextSyncMs: watched ? 2_000 : 15_000,
  };
}
