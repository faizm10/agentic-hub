"use client";

/**
 * AgentHubClient for the web app.
 *
 * - Web chats (OpenAI, Anthropic) run on this site's server with the user's
 *   encrypted API keys and stream back over SSE.
 * - Coding-agent sessions live on paired computers. Their snapshots and
 *   events are synced to the server by the desktop runtime; actions are
 *   queued as commands that the computer runs only if remote control is on.
 *
 * The browser never talks to a local runtime and never sees an API key.
 */
import type { AgentEvent, AgentProvider, DeviceCommand, DeviceSnapshot, ModelInfo, ProviderInfo, Session } from "@agentic-hub/types";
import {
  RuntimeUnavailableError,
  readServerSentEvents,
  summarizeEvents,
  toAgentDescriptor,
  toAgentId,
  toModelOption,
  toProject,
  toProvider,
  toProviderConfig,
  toRunStatus,
  toSessionEvent,
  toSessionSummary,
  type AgentHubClient,
} from "@agentic-hub/ui/client";
import { AGENT_ORDER, MODEL_CHAT_PROJECT_ID, applySessionEvent, type SessionEvent, type StreamDeltaEvent } from "@agentic-hub/ui/model";
import type { AgentId, ConnectionInfo, Device, Project, ProviderConfig, SessionSnapshot, SessionSummary } from "@agentic-hub/ui/model";
import { CLOUD_PROJECT_ID, deviceRef, parseDeviceRef } from "./ids";

export interface DeviceView {
  id: string;
  name: string;
  platform: "macos" | "windows" | "linux";
  online: boolean;
  lastSeenAt: string | null;
  runtimeVersion: string | null;
  allowRemoteControl: boolean;
  snapshot: DeviceSnapshot | null;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const API_PROVIDERS: AgentProvider[] = ["openai", "anthropic"];
const AGENT_PROVIDERS: AgentProvider[] = ["codex", "claude", "muse"];
const CAPS = { execution: true, streaming: true, interactiveMessages: true, approvals: false, cancellation: true, gitDiff: false, modelDiscovery: true, textDeltas: true };
const DISPLAY: Record<AgentProvider, string> = { codex: "Codex", claude: "Claude Code", muse: "Muse Code", openai: "OpenAI", anthropic: "Anthropic" };
const SETUP: Partial<Record<AgentProvider, string>> = { openai: "https://platform.openai.com/api-keys", anthropic: "https://console.anthropic.com/settings/keys" };

export interface WebClientOptions {
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
  pollMs?: number;
}

export type WebClient = AgentHubClient & {
  listDeviceViews(): Promise<DeviceView[]>;
  createPairingCode(): Promise<{ code: string; expiresAt: string }>;
  removeDevice(deviceId: string): Promise<void>;
  deleteChat(sessionId: string): Promise<void>;
  /** Whether actions on this session can be sent from the web, and why not. */
  sessionControl(sessionId: string): { allowed: boolean; reason?: string };
  deviceControl(deviceId: string): { allowed: boolean; reason?: string };
  /** Provider readiness as reported by one paired computer. */
  deviceProviders(deviceId: string): ProviderConfig[];
};

export function createWebClient(options: WebClientOptions = {}): WebClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const pollMs = options.pollMs ?? 2_500;
  let connection: ConnectionInfo = { status: "connecting" };
  const listeners = new Set<(info: ConnectionInfo) => void>();
  const setConnection = (next: ConnectionInfo) => {
    if (next.status === connection.status && next.detail === connection.detail) return;
    connection = next;
    listeners.forEach((l) => l(next));
  };

  let devices: DeviceView[] = [];
  let keyHints: Record<string, string | null> = {};

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body != null) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await doFetch(path, { ...init, headers, credentials: "same-origin" });
    } catch {
      const detail = "Can't reach Agentic Hub. Check your connection.";
      setConnection({ status: "disconnected", detail });
      throw new RuntimeUnavailableError(detail);
    }
    if (response.status === 401) options.onUnauthorized?.();
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (response.status === 503 && body?.error?.code === "NOT_CONFIGURED") setConnection({ status: "disconnected", detail: body.error.message });
      else setConnection({ status: "connected" });
      throw new ApiError(body?.error?.code ?? "INTERNAL_ERROR", response.status, body?.error?.message ?? `Request failed (${response.status})`);
    }
    setConnection({ status: "connected" });
    return (await response.json()) as T;
  }
  const json = (method: string, value?: unknown): RequestInit => ({ method, body: value === undefined ? undefined : JSON.stringify(value) });

  const refreshDevices = async () => {
    devices = (await request<{ devices: DeviceView[] }>("/api/devices")).devices;
    return devices;
  };
  const refreshKeys = async () => {
    const { providers } = await request<{ providers: { provider: string; hint: string | null }[] }>("/api/providers");
    keyHints = Object.fromEntries(providers.map((p) => [p.provider, p.hint]));
    return keyHints;
  };

  /** Readiness as the shared UI expects it: web keys for model APIs, paired computers for coding agents. */
  function providerInfos(): ProviderInfo[] {
    const api = API_PROVIDERS.map((provider): ProviderInfo => {
      const hint = keyHints[provider];
      return {
        provider, displayName: DISPLAY[provider], capabilities: CAPS, kind: "model", authMethod: "api-key", installed: true,
        authenticated: Boolean(hint), ready: Boolean(hint), setupUrl: SETUP[provider],
        credential: hint ? { source: "stored", hint } : null,
        ...(hint ? {} : { reason: `Add your ${DISPLAY[provider]} API key to chat on the web. It's stored encrypted and only used from our server.` }),
      };
    });
    const agents = AGENT_PROVIDERS.map((provider): ProviderInfo => {
      const online = devices.filter((d) => d.online);
      const ready = online.find((d) => d.snapshot?.providers.find((p) => p.provider === provider)?.ready);
      const base = { provider, displayName: DISPLAY[provider], capabilities: { ...CAPS, approvals: true, gitDiff: true }, kind: "agent" as const, authMethod: "cli" as const };
      if (ready) return { ...base, installed: true, authenticated: true, ready: true, reason: `Runs on ${ready.name}.` };
      const reason = !devices.length
        ? "Coding agents run on your computer. Pair the Agentic Hub desktop app under Devices."
        : !online.length
          ? "Your paired computers are offline. Open Agentic Hub on one of them."
          : `${DISPLAY[provider]} isn't set up on your online computers.`;
      return { ...base, installed: devices.length > 0, authenticated: false, ready: false, reason };
    });
    return [...agents, ...api];
  }

  const cloudProject = (): Project => ({ id: CLOUD_PROJECT_ID, name: "Web chats", path: "Model APIs · runs on Agentic Hub", branch: "web", lastOpenedAt: new Date(0).toISOString() });

  function deviceFor(ref: string) {
    const parsed = parseDeviceRef(ref);
    const device = parsed && devices.find((d) => d.id === parsed.deviceId);
    if (!parsed || !device) throw new ApiError("NOT_FOUND", 404, "That computer is no longer paired.");
    return { device, id: parsed.id };
  }

  async function waitForCommand(deviceId: string, commandId: string, timeoutMs = 45_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 800));
      const status = await request<{ status: string; error: string | null; result: Record<string, unknown> | null }>(`/api/devices/${deviceId}/commands/${commandId}`);
      if (status.status === "done") return status.result ?? {};
      if (status.status === "failed") throw new ApiError("COMMAND_FAILED", 409, status.error ?? "The computer couldn't run that.");
    }
    throw new ApiError("TIMEOUT", 504, "The computer didn't respond. Make sure Agentic Hub is open on it.");
  }

  async function command(deviceId: string, cmd: DeviceCommand) {
    const { id } = await request<{ id: string }>(`/api/devices/${deviceId}/commands`, json("POST", cmd));
    return waitForCommand(deviceId, id);
  }

  // ── Live web chats ─────────────────────────────────────────────────────
  type Listener = { onEvent: (event: SessionEvent) => void; onDelta?: (delta: StreamDeltaEvent) => void; afterSeq: number };
  const chatListeners = new Map<string, Set<Listener>>();
  const chatLog = new Map<string, AgentEvent[]>();
  const chatDeltas = new Map<string, Map<string, { kind: "text" | "reasoning"; text: string }>>();
  const activeTurns = new Map<string, AbortController>();

  const emitChatEvent = (chatId: string, event: AgentEvent) => {
    const log = chatLog.get(chatId) ?? [];
    log.push(event);
    chatLog.set(chatId, log);
    if (event.type === "message" || event.type === "completed") chatDeltas.delete(chatId);
    for (const l of chatListeners.get(chatId) ?? []) if (event.sequence > l.afterSeq) l.onEvent(toSessionEvent(event));
  };
  const emitChatDelta = (chatId: string, data: { streamId: string; kind: "text" | "reasoning"; delta: string }) => {
    const buffer = chatDeltas.get(chatId) ?? new Map();
    const entry = buffer.get(data.streamId) ?? { kind: data.kind, text: "" };
    entry.text += data.delta;
    buffer.set(data.streamId, entry);
    chatDeltas.set(chatId, buffer);
    const delta: StreamDeltaEvent = { type: "stream.delta", sessionId: chatId, streamId: data.streamId, kind: data.kind, text: data.delta, at: new Date().toISOString() };
    for (const l of chatListeners.get(chatId) ?? []) l.onDelta?.(delta);
  };

  /** Starts a turn and resolves once the server has accepted it (or rejects with its reason). */
  async function startTurn(chatId: string, text: string): Promise<void> {
    if (activeTurns.has(chatId)) throw new ApiError("CONFLICT", 409, "This chat is already answering.");
    const abort = new AbortController();
    activeTurns.set(chatId, abort);
    let response: Response;
    try {
      response = await doFetch(`/api/chats/${chatId}/messages`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ text }), signal: abort.signal, credentials: "same-origin" });
    } catch {
      activeTurns.delete(chatId);
      throw new RuntimeUnavailableError("Can't reach Agentic Hub. Check your connection.");
    }
    if (!response.ok || !response.body) {
      activeTurns.delete(chatId);
      if (response.status === 401) options.onUnauthorized?.();
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(body?.error?.code ?? "INTERNAL_ERROR", response.status, body?.error?.message ?? "The message wasn't sent.");
    }
    const records = readServerSentEvents(response.body, abort.signal);
    const first = await records.next();
    const handle = (record: { event: string; data: string }) => {
      if (record.event === "delta") emitChatDelta(chatId, JSON.parse(record.data));
      else if (record.event === "agent") emitChatEvent(chatId, JSON.parse(record.data) as AgentEvent);
    };
    if (first.done) {
      activeTurns.delete(chatId);
      throw new ApiError("INTERNAL_ERROR", 500, "The server closed the stream.");
    }
    if (first.value.event === "failure") {
      activeTurns.delete(chatId);
      const failure = JSON.parse(first.value.data) as { code: string; message: string };
      throw new ApiError(failure.code, 409, failure.message);
    }
    handle(first.value);
    void (async () => {
      try {
        for await (const record of records) handle(record);
      } catch {
        // Aborted (stop) or the connection dropped; the server keeps what it has.
      } finally {
        activeTurns.delete(chatId);
      }
    })();
  }

  // ── Snapshots ──────────────────────────────────────────────────────────
  const fold = (summary: SessionSummary, events: AgentEvent[]): SessionSnapshot => {
    const initial: SessionSnapshot = { session: summary, timeline: [], changes: [], tests: [], lastSeq: -1 };
    return events.reduce((s, e) => applySessionEvent(s, toSessionEvent(e)), initial);
  };

  function deviceSessions(): SessionSummary[] {
    return devices.flatMap((device) =>
      (device.snapshot?.sessions ?? []).map((s) => {
        const project = device.snapshot?.projects.find((p) => p.id === s.projectId);
        const summary = toSessionSummary(s as Session, { title: s.title ?? undefined, branch: project?.branch });
        return { ...summary, id: deviceRef(device.id, s.id), projectId: deviceRef(device.id, s.projectId) };
      }),
    );
  }

  const client: WebClient = {
    mode: "live",
    label: "Agentic Hub",
    getConnection: () => connection,
    onConnectionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconnect() {
      setConnection({ status: "connecting" });
      void refreshDevices().catch(() => {});
    },

    async listAgents() {
      await Promise.all([refreshKeys(), refreshDevices()]);
      return providerInfos().map((info) => toAgentDescriptor(info)).sort((a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id));
    },
    async listProviders() {
      await Promise.all([refreshKeys(), refreshDevices()]);
      return providerInfos().map((info) => toProviderConfig(info)).sort((a, b) => AGENT_ORDER.indexOf(a.agentId) - AGENT_ORDER.indexOf(b.agentId));
    },
    async listModels(agentId) {
      const provider = toProvider(agentId);
      if (!API_PROVIDERS.includes(provider)) throw new ApiError("UNSUPPORTED", 422, "Models for coding agents are chosen on the computer that runs them.");
      return (await request<{ models: ModelInfo[] }>(`/api/providers/${provider}/models`)).models.map(toModelOption);
    },
    async setApiKey(agentId, apiKey) {
      await request(`/api/providers/${toProvider(agentId)}/key`, json("PUT", { apiKey }));
      await refreshKeys();
      return toProviderConfig(providerInfos().find((p) => p.provider === toProvider(agentId))!);
    },
    async clearApiKey(agentId) {
      await request(`/api/providers/${toProvider(agentId)}/key`, json("DELETE"));
      await refreshKeys();
      return toProviderConfig(providerInfos().find((p) => p.provider === toProvider(agentId))!);
    },

    async listProjects() {
      await refreshDevices();
      const remote = devices.flatMap((device) =>
        (device.snapshot?.projects ?? []).map((p) => ({ ...toProject(p), id: deviceRef(device.id, p.id), path: `${device.name} · ${p.id === MODEL_CHAT_PROJECT_ID ? "Chats" : p.path}` })),
      );
      return [cloudProject(), ...remote];
    },
    addProject: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Open repositories in the desktop app; they appear here once your computer syncs.")),

    async listSessions(filter) {
      const [{ chats }] = await Promise.all([
        request<{ chats: { session: Session; title: string | null; messageCount: number }[] }>("/api/chats"),
        refreshDevices(),
      ]);
      const web = chats.map((c) => toSessionSummary(c.session, { title: c.title ?? undefined, branch: "web", messageCount: c.messageCount }));
      const all = [...web, ...deviceSessions()];
      return filter?.projectId ? all.filter((s) => s.projectId === filter.projectId) : all;
    },

    async getSession(sessionId) {
      const ref = parseDeviceRef(sessionId);
      if (!ref) {
        const { session, title, events } = await request<{ session: Session; title: string | null; events: AgentEvent[] }>(`/api/chats/${sessionId}`);
        const summary = toSessionSummary(session, { title: title ?? undefined, branch: "web", messageCount: summarizeEvents(events).messageCount });
        const folded = fold(summary, events);
        // A turn may still be streaming in this tab; the folded log is authoritative for persisted events.
        return { ...folded, session: { ...folded.session, status: activeTurns.has(sessionId) ? "running" : toRunStatus(session.status) } };
      }
      if (!devices.length) await refreshDevices();
      const { device, id } = deviceFor(sessionId);
      const session = device.snapshot?.sessions.find((s) => s.id === id);
      if (!session) throw new ApiError("NOT_FOUND", 404, "This session is no longer on that computer.");
      const { events } = await request<{ events: AgentEvent[] }>(`/api/devices/${device.id}/sessions/${id}`);
      const project = device.snapshot?.projects.find((p) => p.id === session.projectId);
      const summary = { ...toSessionSummary(session as Session, { title: session.title ?? undefined, branch: project?.branch }), id: sessionId, projectId: deviceRef(device.id, session.projectId) };
      const folded = fold(summary, events);
      return { ...folded, session: { ...folded.session, status: toRunStatus(session.status) } };
    },

    async createSession({ projectId, agentId, model, prompt }) {
      if (projectId === CLOUD_PROJECT_ID) {
        const provider = toProvider(agentId);
        if (!API_PROVIDERS.includes(provider)) throw new ApiError("UNSUPPORTED", 422, `${DISPLAY[provider]} runs on your computer. Pick one of its projects in the sidebar.`);
        const { session } = await request<{ session: Session }>("/api/chats", json("POST", { provider, model, text: prompt }));
        await startTurn(session.id, prompt);
        return toSessionSummary({ ...session, status: "running" }, { title: prompt.split("\n")[0]!.slice(0, 120), branch: "web", messageCount: 1 });
      }
      const { device, id } = deviceFor(projectId);
      const result = await command(device.id, { type: "create_session", projectId: id, config: { provider: toProvider(agentId), ...(model ? { model } : {}) }, text: prompt });
      const sessionId = String(result.sessionId ?? "");
      if (!sessionId) throw new ApiError("INTERNAL_ERROR", 500, "The computer didn't return a session.");
      await refreshDevices().catch(() => {});
      const now = new Date().toISOString();
      return { id: deviceRef(device.id, sessionId), projectId, title: prompt.split("\n")[0]!.slice(0, 120), agentId, model, status: "running", branch: "", createdAt: now, updatedAt: now, messageCount: 1 };
    },
    async sendMessage(sessionId, text) {
      const ref = parseDeviceRef(sessionId);
      if (!ref) return startTurn(sessionId, text);
      const { device, id } = deviceFor(sessionId);
      await command(device.id, { type: "send_message", sessionId: id, text });
    },
    listQueuedMessages: async () => [],
    removeQueuedMessage: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Manage queued messages in the desktop app.")),
    getAutoApprove: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Approval settings are managed on your computer.")),
    setAutoApprove: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Approval settings are managed on your computer.")),
    getDeveloperActivity: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Developer activity is available in the desktop app.")),
    updateRepository: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Update repositories in the desktop app.")),
    getIdeUpdate: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "IDE updates are available in the desktop app.")),
    openIdeUpdate: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "IDE updates are available in the desktop app.")),
    async cancelRun(sessionId) {
      const ref = parseDeviceRef(sessionId);
      if (!ref) {
        activeTurns.get(sessionId)?.abort();
        return;
      }
      const { device, id } = deviceFor(sessionId);
      await command(device.id, { type: "cancel", sessionId: id });
    },
    async resolveApproval(sessionId, approvalId, decision) {
      const { device } = deviceFor(sessionId);
      await command(device.id, { type: "resolve_approval", approvalId, decision: decision === "approve" ? "approve" : "deny" });
    },
    getDiff: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "File diffs stay on your computer. Open the session in the desktop app to review them.")),

    subscribe(sessionId, afterSeq, onEvent, onDelta) {
      const ref = parseDeviceRef(sessionId);
      if (!ref) {
        const listener: Listener = { onEvent, onDelta, afterSeq };
        const set = chatListeners.get(sessionId) ?? new Set();
        set.add(listener);
        chatListeners.set(sessionId, set);
        for (const event of chatLog.get(sessionId) ?? []) if (event.sequence > afterSeq) onEvent(toSessionEvent(event));
        for (const [streamId, entry] of chatDeltas.get(sessionId) ?? [])
          onDelta?.({ type: "stream.delta", sessionId, streamId, kind: entry.kind, text: entry.text, at: new Date().toISOString() });
        return () => set.delete(listener);
      }
      // Device sessions: poll the synced copy.
      let cursor = afterSeq;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tick = async () => {
        try {
          const { device, id } = deviceFor(sessionId);
          const { events } = await request<{ events: AgentEvent[] }>(`/api/devices/${device.id}/sessions/${id}?after=${cursor}`);
          for (const event of events) {
            if (stopped || event.sequence <= cursor) continue;
            cursor = event.sequence;
            onEvent({ ...toSessionEvent(event), sessionId });
          }
        } catch {
          // Offline or unpaired; keep trying quietly.
        }
        if (!stopped) timer = setTimeout(tick, pollMs);
      };
      timer = setTimeout(tick, pollMs);
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },

    async listDevices() {
      await refreshDevices();
      return devices.map(
        (d): Device => ({
          id: d.id, name: d.name, platform: d.platform, status: d.online ? "online" : "offline", lastSeenAt: d.lastSeenAt ?? new Date(0).toISOString(),
          runtimeVersion: d.runtimeVersion ?? undefined, projectCount: d.snapshot?.projects.length ?? 0,
          activeSessionCount: d.snapshot?.sessions.filter((s) => s.status === "running" || s.status === "awaiting_approval").length ?? 0,
        }),
      );
    },
    listActivity: () => Promise.resolve([]),
    remoteActionsAvailable: () => true,
    getPairing: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Pairing is set up from the desktop app.")),
    pair: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Pairing is set up from the desktop app.")),
    updatePairing: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Pairing is set up from the desktop app.")),
    unpair: () => Promise.reject(new ApiError("UNSUPPORTED", 422, "Pairing is set up from the desktop app.")),

    listDeviceViews: refreshDevices,
    createPairingCode: () => request("/api/devices/pairing-code", json("POST")),
    async removeDevice(deviceId) {
      await request(`/api/devices/${deviceId}`, json("DELETE"));
      await refreshDevices();
    },
    async deleteChat(sessionId) {
      await request(`/api/chats/${sessionId}`, json("DELETE"));
    },
    sessionControl(sessionId) {
      const ref = parseDeviceRef(sessionId);
      return ref ? client.deviceControl(ref.deviceId) : { allowed: true };
    },
    deviceProviders(deviceId) {
      const device = devices.find((d) => d.id === deviceId);
      return (device?.snapshot?.providers ?? [])
        .map((info) => toProviderConfig(device?.online ? info : { ...info, ready: false, reason: `${device?.name ?? "This computer"} is offline.` }))
        .sort((a, b) => AGENT_ORDER.indexOf(a.agentId) - AGENT_ORDER.indexOf(b.agentId));
    },
    deviceControl(deviceId) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return { allowed: false, reason: "That computer is no longer paired." };
      if (!device.online) return { allowed: false, reason: `${device.name} is offline. Open Agentic Hub on it to continue.` };
      if (!device.allowRemoteControl) return { allowed: false, reason: `View only: turn on "Allow control from the web" in the desktop app on ${device.name}.` };
      return { allowed: true };
    },
  };
  return client;
}

/** Display helpers shared by web screens. */
export const agentIdFor = (provider: AgentProvider): AgentId => toAgentId(provider);
export type { ProviderConfig };
