/** Shared between server and browser code. */

/** The pseudo-project that holds web chats with model APIs. */
export const CLOUD_PROJECT_ID = "00000000-0000-4000-8000-000000000000";

/** Device projects and sessions are addressed as `<deviceId>~<id>` in the web UI. */
export const deviceRef = (deviceId: string, id: string) => `${deviceId}~${id}`;

export function parseDeviceRef(ref: string): { deviceId: string; id: string } | null {
  const [deviceId, id, extra] = ref.split("~");
  return deviceId && id && extra === undefined ? { deviceId, id } : null;
}
