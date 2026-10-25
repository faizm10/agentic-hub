# Web control plane (device pairing and sync)

A paired runtime makes **outbound HTTPS requests only**. The web app never connects to a device, and the runtime never listens on a public interface. Schemas are in `@agentic-hub/types` (`DeviceSnapshot`, `DeviceCommand`, `PairingStatus`); server code is in `apps/web/lib/server/devices.ts`; the runtime side is `apps/runtime/src/control-plane.ts`.

## Pairing

1. A signed-in user calls `POST /api/devices/pairing-code` and gets a code like `ABCD-2345`. It's single use, valid for 10 minutes, and stored as a SHA-256 hash.
2. The user enters the web address and code in the desktop app. The runtime's `POST /pairing` (local API) validates the URL (HTTPS, or HTTP on localhost only, no embedded credentials) and calls `POST {url}/api/device/pair` with `{ code, name, platform, runtimeVersion }`.
3. The server consumes the code atomically, creates the device and returns `{ deviceId, deviceToken }`. The token is 256 random bits; the server keeps only its hash. The runtime stores the configuration (URL, device ID, token, remote-control flag) encrypted in its own database.

## Sync

The runtime calls `POST {url}/api/device/sync` with `Authorization: Bearer <deviceToken>` and:

```json
{ "snapshot": DeviceSnapshot, "events": AgentEvent[], "acks": [{ "id": "...", "ok": true, "result": {} }] }
```

- `snapshot` holds providers (readiness, never credentials), projects, the latest 50 sessions with titles, the runtime version and whether remote control is allowed.
- `events` are new persisted events since the last acknowledged cursor per session, capped at 400 events and about 2.5 MB per request (Vercel limits request bodies to 4.5 MB). Very large text fields are truncated in the web copy.
- The response is `{ commands: [{ id, command }], nextSyncMs }`. `nextSyncMs` is 2000 while someone has the web app open and 15000 otherwise. The runtime syncs again sooner when it has acks or more events to send, and backs off to 30 s on errors.

The server stores the snapshot and events encrypted (AES-256-GCM), marks the device online (seen within 45 s), settles acked commands, fails commands older than two minutes, and hands out pending ones.

A `401` or `410` means the device was removed. The runtime then forgets its pairing and shows "This device was removed from the web app."

## Commands

`DeviceCommand` is one of `create_session`, `send_message`, `cancel` and `resolve_approval`. The web queues them with `POST /api/devices/:id/commands`, which is refused unless the device is online and reports `allowRemoteControl: true`. The runtime refuses them anyway unless remote control is on locally; only the desktop app can turn it on. Results come back as acks; the web polls `GET /api/devices/:id/commands/:commandId`.

## Unpairing

The desktop app's **Disconnect** removes the local configuration and calls `POST /api/device/unpair`. Removing the device in the web app revokes the token immediately.
