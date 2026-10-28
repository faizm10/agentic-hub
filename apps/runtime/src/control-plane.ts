/**
 * Outbound-only link from this runtime to the Agentic Hub web control plane.
 *
 * The runtime never listens on a public interface. After pairing it polls the
 * control plane over HTTPS with a per-device bearer token, uploads a snapshot
 * of providers, projects and sessions plus new session events, and receives
 * queued commands. Commands run only when the user has turned on
 * "Allow control from the web" on this machine; otherwise they are refused.
 */
import { hostname, platform as osPlatform } from 'node:os';
import type { AgentRegistry, SessionManager } from '@agentic-hub/agent-core';
import { HubError } from '@agentic-hub/agent-core';
import type { Store } from '@agentic-hub/database';
import { DeviceCommandSchema, type AgentEvent, type DeviceCommand, type DeviceSnapshot, type ModelInfo, type PairingStatus, type ProviderInfo, type QueuedMessage, type UsageReport } from '@agentic-hub/types';

export const RUNTIME_VERSION = '0.3.1';
const CONFIG = 'controlPlane:config';
const CURSORS = 'controlPlane:cursors';
const MAX_EVENTS_PER_SYNC = 400;
const MAX_SYNCED_SESSIONS = 50;
/** Hosted control planes cap request bodies (Vercel: 4.5 MB), so each sync stays well below. */
const MAX_EVENT_BYTES = 2_500_000;
const MAX_EVENT_TEXT = 200_000;

interface Config {
  url: string;
  deviceId: string;
  deviceName: string;
  token: string;
  allowRemoteControl: boolean;
}
interface Ack { id: string; ok: boolean; error?: string; result?: Record<string, unknown> }
interface SyncResponse { commands?: { id: string; command: unknown }[]; nextSyncMs?: number }

export type Fetch = typeof fetch;

/** Very large tool output is shortened for the web copy; the full text stays on this computer. */
function truncateEvent(event: AgentEvent): AgentEvent {
  const cut = (text: string) => (text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT)}\n… (truncated; full output is on the device)` : text);
  if (event.type === 'tool_result') return { ...event, output: cut(event.output) };
  if (event.type === 'message' || event.type === 'reasoning_summary') return { ...event, text: cut(event.text) };
  return event;
}

/** Only HTTPS, except loopback during development. */
export function validateControlPlaneUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HubError('VALIDATION_ERROR', 400, 'Enter the web app URL, e.g. https://agentic-hub.vercel.app'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new HubError('VALIDATION_ERROR', 400, 'The control plane must use HTTPS');
  if (url.username || url.password) throw new HubError('VALIDATION_ERROR', 400, 'The control plane URL must not contain credentials');
  return url.origin;
}

function devicePlatform(): DeviceSnapshot['platform'] {
  const p = osPlatform();
  return p === 'darwin' ? 'macos' : p === 'win32' ? 'windows' : 'linux';
}

export class ControlPlaneConnector {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private stopped = false;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private acks: Ack[] = [];

  constructor(
    private readonly store: Store,
    private readonly registry: AgentRegistry,
    private readonly manager: SessionManager,
    private readonly fetchImpl: Fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private config(): Config | null {
    const raw = this.store.secret(CONFIG);
    return raw ? JSON.parse(raw) as Config : null;
  }
  private saveConfig(config: Config | null): void {
    if (config) this.store.setSecret(CONFIG, JSON.stringify(config));
    else { this.store.deleteSecret(CONFIG); this.store.deleteSecret(CURSORS); }
  }
  private cursors(): Record<string, number> {
    const raw = this.store.secret(CURSORS);
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  }

  status(): PairingStatus {
    const config = this.config();
    return {
      paired: Boolean(config), controlPlaneUrl: config?.url ?? null, deviceId: config?.deviceId ?? null, deviceName: config?.deviceName ?? null,
      allowRemoteControl: config?.allowRemoteControl ?? false, lastSyncAt: this.lastSyncAt, lastError: this.lastError,
    };
  }

  start(): void {
    this.stopped = false;
    if (this.config()) this.schedule(500);
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.sync(); }, ms);
    this.timer.unref?.();
  }

  async pair(input: { controlPlaneUrl: string; code: string; deviceName?: string | undefined }): Promise<PairingStatus> {
    const url = validateControlPlaneUrl(input.controlPlaneUrl);
    const deviceName = input.deviceName?.trim() || hostname().replace(/\.local$/, '');
    let response: Response;
    try {
      response = await this.fetchImpl(`${url}/api/device/pair`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: input.code.trim().toUpperCase(), name: deviceName, platform: devicePlatform(), runtimeVersion: RUNTIME_VERSION }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new HubError('PROVIDER_UNAVAILABLE', 503, `Could not reach ${url}`); }
    const body = await response.json().catch(() => null) as { deviceId?: string; deviceToken?: string; error?: { message?: string } } | null;
    if (!response.ok || !body?.deviceId || !body.deviceToken) throw new HubError('VALIDATION_ERROR', 400, body?.error?.message ?? `Pairing failed (${response.status})`);
    this.saveConfig({ url, deviceId: body.deviceId, deviceName, token: body.deviceToken, allowRemoteControl: false });
    this.lastError = null;
    this.schedule(0);
    return this.status();
  }

  update(input: { allowRemoteControl: boolean }): PairingStatus {
    const config = this.config();
    if (!config) throw new HubError('CONFLICT', 409, 'This runtime is not paired');
    this.saveConfig({ ...config, allowRemoteControl: input.allowRemoteControl });
    this.schedule(0);
    return this.status();
  }

  async unpair(): Promise<PairingStatus> {
    const config = this.config();
    this.saveConfig(null);
    this.lastSyncAt = null;
    this.lastError = null;
    if (config) {
      // Best effort: the server also forgets devices that stop syncing.
      await this.fetchImpl(`${config.url}/api/device/unpair`, { method: 'POST', headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
    return this.status();
  }

  private usageCache: { at: number; value: UsageReport } | null = null;
  private modelsCache: { at: number; value: Record<string, ModelInfo[]> } | null = null;

  /** Models of ready coding agents, refreshed every few minutes (listing can start a CLI). */
  private async agentModels(providers: ProviderInfo[]): Promise<Record<string, ModelInfo[]>> {
    if (this.modelsCache && Date.now() - this.modelsCache.at < 5 * 60_000) return this.modelsCache.value;
    const value: Record<string, ModelInfo[]> = {};
    await Promise.all(providers.filter(p => p.ready && p.kind === 'agent' && p.capabilities.modelDiscovery).map(async p => {
      try { value[p.provider] = await this.registry.listModels(p.provider); } catch { /* Shown as "default" on the web. */ }
    }));
    this.modelsCache = { at: Date.now(), value };
    return value;
  }

  private async snapshot(config: Config): Promise<DeviceSnapshot> {
    const sessions = this.store.sessions().slice(0, MAX_SYNCED_SESSIONS);
    const providers = await this.registry.list();
    if (!this.usageCache || Date.now() - this.usageCache.at > 60_000) this.usageCache = { at: Date.now(), value: this.manager.usageReport({ source: hostname(), days: 90 }) };
    const queues: Record<string, QueuedMessage[]> = {};
    for (const session of sessions) {
      const queued = this.store.queuedMessages(session.id);
      if (queued.length) queues[session.id] = queued;
    }
    return {
      runtimeVersion: RUNTIME_VERSION, platform: devicePlatform(), allowRemoteControl: config.allowRemoteControl,
      providers, projects: this.store.projects(),
      sessions: sessions.map(session => ({ ...session, title: this.store.sessionTitle(session.id) })),
      models: await this.agentModels(providers), queues, usage: this.usageCache.value,
    };
  }

  private pendingEvents(sessions: DeviceSnapshot['sessions']): { events: AgentEvent[]; cursors: Record<string, number>; more: boolean } {
    const cursors = this.cursors();
    const events: AgentEvent[] = [];
    let bytes = 0;
    for (const session of sessions) {
      for (const raw of this.store.events(session.id, cursors[session.id] ?? -1)) {
        const event = truncateEvent(raw);
        const size = JSON.stringify(event).length;
        if (events.length >= MAX_EVENTS_PER_SYNC || (events.length && bytes + size > MAX_EVENT_BYTES)) return { events, cursors, more: true };
        events.push(event);
        bytes += size;
      }
    }
    return { events, cursors, more: false };
  }

  /** One round trip: upload state and acks, receive commands. Exposed for tests. */
  async sync(): Promise<void> {
    const config = this.config();
    if (!config || this.syncing) return;
    this.syncing = true;
    let next = 20_000;
    try {
      const snapshot = await this.snapshot(config);
      const { events, cursors, more } = this.pendingEvents(snapshot.sessions);
      const acks = this.acks.splice(0);
      let response: Response;
      try {
        response = await this.fetchImpl(`${config.url}/api/device/sync`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
          body: JSON.stringify({ snapshot, events, acks }), signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        this.acks.unshift(...acks);
        throw error;
      }
      if (response.status === 401 || response.status === 410) {
        this.saveConfig(null);
        this.lastError = 'This device was removed from the web app. Pair it again to reconnect.';
        return;
      }
      if (!response.ok) { this.acks.unshift(...acks); throw new Error(`Control plane returned ${response.status}`); }
      const body = await response.json() as SyncResponse;
      for (const event of events) cursors[event.sessionId] = Math.max(cursors[event.sessionId] ?? -1, event.sequence);
      this.store.setSecret(CURSORS, JSON.stringify(cursors));
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      for (const entry of body.commands ?? []) this.acks.push(await this.execute(entry.id, entry.command, config));
      next = this.acks.length || more ? 250 : Math.min(Math.max(body.nextSyncMs ?? 15_000, 1_000), 60_000);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Sync failed';
      next = 30_000;
    } finally {
      this.syncing = false;
      if (this.config()) this.schedule(next);
    }
  }

  private async execute(id: string, raw: unknown, config: Config): Promise<Ack> {
    if (!config.allowRemoteControl) return { id, ok: false, error: 'Control from the web is turned off on this device.' };
    const parsed = DeviceCommandSchema.safeParse(raw);
    if (!parsed.success) return { id, ok: false, error: 'Unsupported command' };
    try {
      return { id, ok: true, result: await this.run(parsed.data) };
    } catch (error) {
      return { id, ok: false, error: error instanceof Error ? error.message : 'Command failed' };
    }
  }

  private async run(command: DeviceCommand): Promise<Record<string, unknown>> {
    switch (command.type) {
      case 'create_session': {
        const session = await this.manager.create(command.projectId, command.config, command.isolation ?? 'none', command.groupId);
        await this.manager.send(session.id, command.text);
        return { sessionId: session.id };
      }
      case 'send_message': await this.manager.sendOrQueue(command.sessionId, command.text); return {};
      case 'cancel': await this.manager.cancel(command.sessionId); return {};
      case 'resolve_approval': await this.manager.resolveApproval(command.approvalId, command.decision); return {};
      case 'remove_queued':
        if (!this.store.deleteQueuedMessage(command.sessionId, command.messageId)) throw new Error('That message is no longer queued.');
        return {};
    }
  }
}
