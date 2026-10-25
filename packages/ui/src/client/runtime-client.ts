/**
 * Live AgentHubClient over the local runtime's v1 HTTP API
 * (docs/API_CONTRACT.md). All backend semantics stay in the runtime: this
 * client only issues requests and maps responses through ./adapters.
 *
 * Authentication: pass `token` when the caller legitimately holds the
 * runtime's bearer token (Node, tests). In the desktop webview the token is
 * injected by a same-origin bridge instead, so it never reaches page script.
 */
import type {
  AgentEvent,
  ApiError,
  CreateProjectResponse,
  GetProjectsResponse,
  GetProvidersResponse,
  GetSessionDiffResponse,
  GetSessionEventsResponse,
  GetSessionsResponse,
  Project as ContractProject,
  SendMessageResponse,
  SessionResponse,
} from "@agentic-hub/types";
import { applySessionEvent } from "../model/events";
import type { ConnectionInfo, FileChange, SessionSnapshot } from "../model/types";
import {
  changesWorkingTree,
  splitPatch,
  summarizeEvents,
  toAgentDescriptor,
  toContractDecision,
  toFileChange,
  toFileDiff,
  toProject,
  toProvider,
  toProviderConfig,
  toRunStatus,
  toSessionEvent,
  toSessionSummary,
} from "./adapters";
import { NotImplementedYetError, RuntimeUnavailableError } from "./errors";
import { createReconnectingStream, type StreamTransport } from "./reconnecting-stream";
import type { AgentHubClient } from "./types";

/** A non-2xx response from the runtime, carrying its `{ error: { code } }`. */
export class RuntimeApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeApiError";
  }
}

export interface RuntimeClientOptions {
  /** Runtime base URL, e.g. "http://127.0.0.1:43117" or a same-origin bridge like "/runtime". */
  baseUrl: string;
  token?: string;
  label?: string;
  fetch?: typeof fetch;
  /** How often to re-probe the runtime while it is unreachable / reachable. */
  retryMs?: number;
  heartbeatMs?: number;
}

export type RuntimeClient = AgentHubClient & { dispose(): void };

/** Parse `text/event-stream` records from a fetch body. Comments (heartbeats) are skipped. */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const record = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let id: string | undefined;
        let event = "message";
        const data: string[] = [];
        for (const line of record.split(/\r?\n/)) {
          if (!line || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          else if (field === "id") id = value;
          else if (field === "event") event = value;
        }
        if (data.length) yield { id, event, data: data.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const userMessage = (sessionId: string, text: string): AgentEvent => ({
  type: "message",
  role: "user",
  text,
  id: "",
  sessionId,
  taskRunId: "",
  sequence: 0,
  createdAt: new Date().toISOString(),
});

export function createRuntimeClient(options: RuntimeClientOptions): RuntimeClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const retryMs = options.retryMs ?? 5_000;
  const heartbeatMs = options.heartbeatMs ?? 10_000;

  let connection: ConnectionInfo = { status: "connecting" };
  const listeners = new Set<(info: ConnectionInfo) => void>();
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const setConnection = (next: ConnectionInfo) => {
    if (next.status === connection.status && next.detail === connection.detail && next.retryAt === connection.retryAt) return;
    connection = next;
    listeners.forEach((listener) => listener(connection));
  };

  const markUnavailable = (detail: string) => {
    setConnection({ status: "disconnected", detail, retryAt: Date.now() + retryMs });
    scheduleProbe(retryMs);
  };

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body != null) headers.set("content-type", "application/json");
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      const detail = `Can't reach the local runtime at ${base}. Start it with \`pnpm runtime:start\`.`;
      markUnavailable(detail);
      throw new RuntimeUnavailableError(detail);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      const code = body?.error?.code ?? "INTERNAL_ERROR";
      const message = body?.error?.message ?? `Runtime request failed (${response.status}).`;
      // The bridge answers RUNTIME_UNAVAILABLE when the runtime process or its token is missing.
      if (code === "RUNTIME_UNAVAILABLE") {
        markUnavailable(message);
        throw new RuntimeUnavailableError(message);
      }
      if (code === "UNAUTHORIZED") {
        const detail = "The runtime rejected this client's token. Restart the runtime or the desktop app.";
        markUnavailable(detail);
        throw new RuntimeUnavailableError(detail);
      }
      setConnection({ status: "connected" });
      throw new RuntimeApiError(code, response.status, message);
    }
    setConnection({ status: "connected" });
    return (await response.json()) as T;
  }

  const json = (method: string, value?: unknown): RequestInit => ({
    method,
    body: value === undefined ? undefined : JSON.stringify(value),
  });

  /** Cheap authenticated call used to detect connectivity. */
  const probe = () =>
    request<GetProjectsResponse>("/projects").then(
      () => scheduleProbe(heartbeatMs),
      () => {},
    );

  function scheduleProbe(ms: number) {
    if (disposed) return;
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void probe();
    }, ms);
  }

  const projectsById = async () =>
    new Map((await request<GetProjectsResponse>("/projects")).projects.map((p): [string, ContractProject] => [p.id, p]));

  const events = (sessionId: string, after = -1) =>
    request<GetSessionEventsResponse>(`/sessions/${sessionId}/events?after=${after}`);

  const diff = (sessionId: string) => request<GetSessionDiffResponse>(`/sessions/${sessionId}/diff`).then((r) => r.diff);

  const fileChanges = async (sessionId: string): Promise<FileChange[]> => (await diff(sessionId)).files.map(toFileChange);

  void probe();

  const client: RuntimeClient = {
    mode: "live",
    label: options.label ?? "Local runtime",

    getConnection: () => connection,
    onConnectionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconnect() {
      setConnection({ status: "connecting" });
      void probe();
    },

    async listAgents() {
      return (await request<GetProvidersResponse>("/providers")).providers.map(toAgentDescriptor);
    },
    async listProviders() {
      return (await request<GetProvidersResponse>("/providers")).providers.map(toProviderConfig);
    },

    async listProjects() {
      return (await request<GetProjectsResponse>("/projects")).projects.map(toProject);
    },
    async addProject(path) {
      return toProject((await request<CreateProjectResponse>("/projects", json("POST", { path }))).project);
    },

    async listSessions(filter) {
      const [{ sessions }, projects] = await Promise.all([request<GetSessionsResponse>("/sessions"), projectsById()]);
      const selected = filter?.projectId ? sessions.filter((s) => s.projectId === filter.projectId) : sessions;
      return Promise.all(
        selected.map(async (session) => {
          const summary = await events(session.id).then(
            (r) => summarizeEvents(r.events),
            () => ({ title: undefined, messageCount: 0 }),
          );
          return toSessionSummary(session, { ...summary, branch: projects.get(session.projectId)?.branch });
        }),
      );
    },

    async getSession(sessionId) {
      const [{ session }, log, projects, gitDiff] = await Promise.all([
        request<SessionResponse>(`/sessions/${sessionId}`),
        events(sessionId),
        projectsById(),
        diff(sessionId).catch(() => null),
      ]);
      const initial: SessionSnapshot = {
        session: toSessionSummary(session, { branch: projects.get(session.projectId)?.branch }),
        timeline: [],
        changes: gitDiff?.files.map(toFileChange) ?? [],
        tests: [],
        lastSeq: -1,
      };
      const folded = log.events.reduce((snapshot, event) => applySessionEvent(snapshot, toSessionEvent(event)), initial);
      const { title, messageCount } = summarizeEvents(log.events);
      return {
        ...folded,
        // The persisted session is authoritative (e.g. `interrupted` after a restart).
        session: {
          ...folded.session,
          title: title ?? folded.session.title,
          messageCount,
          status: toRunStatus(session.status),
          updatedAt: session.updatedAt,
        },
      };
    },

    async createSession({ projectId, agentId, prompt }) {
      const { session } = await request<SessionResponse>(
        "/sessions",
        json("POST", { projectId, config: { provider: toProvider(agentId) } }),
      );
      const project = (await projectsById()).get(projectId);
      try {
        await request<SendMessageResponse>(`/sessions/${session.id}/messages`, json("POST", { text: prompt }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        throw new Error(`The session was created, but the first message wasn't sent: ${reason}`, { cause: error });
      }
      return toSessionSummary(
        { ...session, status: "running" },
        { title: summarizeEvents([userMessage(session.id, prompt)]).title, branch: project?.branch, messageCount: 1 },
      );
    },
    async sendMessage(sessionId, text) {
      await request<SendMessageResponse>(`/sessions/${sessionId}/messages`, json("POST", { text }));
    },
    async cancelRun(sessionId) {
      await request<SessionResponse>(`/sessions/${sessionId}/cancel`, json("POST"));
    },
    async resolveApproval(_sessionId, approvalId, decision) {
      await request(`/approvals/${approvalId}/resolve`, json("POST", { decision: toContractDecision(decision) }));
    },
    async getDiff(sessionId, path) {
      const gitDiff = await diff(sessionId);
      const file = gitDiff.files.find((f) => f.path === path);
      if (!file) throw new RuntimeApiError("NOT_FOUND", 404, `${path} has no uncommitted changes.`);
      return toFileDiff(file, splitPatch(gitDiff.patch).get(path));
    },

    subscribe(sessionId, afterSeq, onEvent) {
      let cursor = afterSeq;
      let closed = false;
      // Diff refreshes are async; a promise chain keeps delivery in sequence order.
      let queue = Promise.resolve();

      const transport: StreamTransport<AgentEvent> = {
        open({ onOpen, onMessage, onClose }) {
          const abort = new AbortController();
          const headers = new Headers({ accept: "text/event-stream" });
          if (options.token) headers.set("authorization", `Bearer ${options.token}`);
          (async () => {
            const response = await doFetch(`${base}/sessions/${sessionId}/events?after=${cursor}`, {
              headers,
              signal: abort.signal,
            });
            if (!response.ok || !response.body) throw new Error(`Event stream failed (${response.status}).`);
            onOpen();
            for await (const record of readServerSentEvents(response.body, abort.signal)) {
              onMessage(JSON.parse(record.data) as AgentEvent);
            }
            throw new Error("Event stream ended.");
          })().catch((error: unknown) => {
            if (!abort.signal.aborted) onClose(error);
          });
          return { close: () => abort.abort() };
        },
      };

      const stream = createReconnectingStream<AgentEvent>({
        transport,
        onMessage(event) {
          if (event.sessionId !== sessionId || event.sequence <= cursor) return;
          cursor = event.sequence;
          queue = queue.then(async () => {
            const extra = changesWorkingTree(event)
              ? await fileChanges(sessionId).then(
                  (changes) => [{ type: "files.changed" as const, changes }],
                  () => [],
                )
              : [];
            if (!closed) onEvent(toSessionEvent(event, extra));
          });
        },
        onStatus(info) {
          // A dropped stream usually means the runtime went away; let the probe decide.
          if (info.status === "reconnecting") void probe();
        },
      });

      return () => {
        closed = true;
        stream.close();
      };
    },

    listDevices: () => Promise.reject(new NotImplementedYetError("Device listing")),
    listActivity: () => Promise.reject(new NotImplementedYetError("The activity feed")),
    // The desktop talks to its own local runtime, so actions aren't "remote".
    remoteActionsAvailable: () => false,

    dispose() {
      disposed = true;
      if (probeTimer) clearTimeout(probeTimer);
      listeners.clear();
    },
  };
  return client;
}
