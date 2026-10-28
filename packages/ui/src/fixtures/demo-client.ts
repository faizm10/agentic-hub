/**
 * DEMO CLIENT. Serves fixture data and replays scripted event streams so the
 * interface can be explored without a runtime. Every replay begins with an
 * explicit notice that no agent is running, and the client reports
 * `mode: "demo"` so shells render a persistent demo label.
 */
import type { AgentHubClient, Unsubscribe } from "../client/types";
import { unsupportedWorkspace } from "../client/workspace-stubs";
import { applySessionEvent, type SessionEvent, type SessionEventPayload } from "../model/events";
import type { AgentId, ApprovalDecision, ConnectionInfo, Project, SessionSnapshot, SessionSummary } from "../model/types";
import {
  demoActivity,
  demoAgents,
  demoDevices,
  demoDiffs,
  demoProjects,
  demoProviders,
  demoSessions,
  demoSnapshots,
} from "./data";

type Step = { delay: number; event: SessionEventPayload } | { delay: number; waitForApproval: string };

const clone = <T>(value: T): T => structuredClone(value);

export interface DemoClientOptions {
  /** Multiplier for replay delays. 0 replays synchronously-ish (tests). */
  speed?: number;
  /** Simulated latency for data calls, in ms. */
  latencyMs?: number;
}

const READ_ONLY = "Demo mode is read-only. Connect to the local runtime to change settings.";

export const DEMO_NOTICE = "Demo replay — scripted fixture events. No agent is running and nothing on disk changes.";

function chunk(text: string, size = 14) {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

function buildScript(prompt: string, agentId: AgentId, runId: string): Step[] {
  const reasoning = true;
  const msg = `${runId}-a`;
  const steps: Step[] = [
    { delay: 0, event: { type: "notice", text: DEMO_NOTICE, tone: "neutral" } },
    { delay: 120, event: { type: "run.status", status: "running" } },
  ];
  if (reasoning) {
    const rid = `${runId}-r`;
    for (const part of chunk(
      `The request is "${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}". I'd start by locating the relevant module and its tests, then propose a minimal change.`,
      18,
    )) {
      steps.push({ delay: 35, event: { type: "reasoning.delta", reasoningId: rid, text: part } });
    }
    steps.push({ delay: 80, event: { type: "reasoning.completed", reasoningId: rid, durationMs: 1800 } });
  }
  const search = `${runId}-t1`;
  steps.push(
    { delay: 200, event: { type: "tool.started", toolId: search, tool: "search", title: "Search the repository", input: 'rg -n "TODO" src --max-count 3' } },
    { delay: 350, event: { type: "tool.output", toolId: search, chunk: "src/webhooks/queue.ts:12:// TODO: surface dead-letter count\n" } },
    { delay: 120, event: { type: "tool.output", toolId: search, chunk: "src/util/sleep.ts:1:// TODO: abortable sleep\n" } },
    { delay: 120, event: { type: "tool.completed", toolId: search, status: "succeeded", exitCode: 0 } },
  );
  const approvalId = `${runId}-ap`;
  steps.push(
    {
      delay: 300,
      event: {
        type: "approval.requested",
        approval: {
          id: approvalId,
          tool: "shell",
          title: "Run the unit test suite",
          command: "pnpm vitest run",
          reason: "Executes project scripts from package.json in the repository.",
          risk: "medium",
        },
      },
    },
    { delay: 0, event: { type: "run.status", status: "awaiting_approval" } },
    { delay: 0, waitForApproval: approvalId },
  );
  steps.push({ delay: 200, event: { type: "message.started", messageId: msg, role: "assistant" } });
  return steps.concat(
    chunk(
      "This is the end of the scripted demo. In a live session the agent would continue from here — its tool calls, file changes and test results would stream into this timeline and the review panel.",
    ).map((text, i): Step => ({ delay: i === 0 ? 250 : 28, event: { type: "message.delta", messageId: msg, text } })),
    [
      { delay: 40, event: { type: "message.completed", messageId: msg } },
      { delay: 60, event: { type: "run.status", status: "completed" } },
    ],
  );
}

/** Deterministic sample usage for the stats page (clearly labeled as sample data). */
function demoUsage(): import("@agentic-hub/types").UsageReport {
  const providers = [["claude", "claude-opus-5-5", 0.000015], ["codex", "gpt-5.5-codex", null], ["openai", "gpt-5.5", null], ["anthropic", "claude-sonnet-5-5", null]] as const;
  const today = Date.now();
  const daily: import("@agentic-hub/types").UsageReport["daily"] = [];
  for (let d = 13; d >= 0; d--) {
    const date = new Date(today - d * 86_400_000).toISOString().slice(0, 10);
    providers.forEach(([provider], i) => {
      const wave = 1 + Math.sin((d + i * 3) / 2.2) * 0.6;
      const input = Math.round((40_000 - i * 8_000) * wave);
      daily.push({ date, provider, inputTokens: input, outputTokens: Math.round(input / 6), cacheReadTokens: Math.round(input * 1.8), cacheWriteTokens: 0, reasoningTokens: Math.round(input / 20), costUsd: provider === "claude" ? +(input * 0.000015).toFixed(4) : null, turns: 3 + ((d + i) % 5) });
    });
  }
  const byModel = providers.map(([provider, model]) => {
    const rows = daily.filter((r) => r.provider === provider);
    const sum = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "reasoningTokens" | "turns") => rows.reduce((t, r) => t + r[k], 0);
    const cost = rows.reduce((t, r) => t + (r.costUsd ?? 0), 0);
    return { provider, model, sessions: 6, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cacheReadTokens: sum("cacheReadTokens"), cacheWriteTokens: 0, reasoningTokens: sum("reasoningTokens"), costUsd: provider === "claude" ? +cost.toFixed(2) : null, turns: sum("turns") };
  });
  return { generatedAt: new Date().toISOString(), source: "Sample data", byModel, daily };
}

export function createDemoClient(options: DemoClientOptions = {}): AgentHubClient {
  const speed = options.speed ?? 1;
  const latency = options.latencyMs ?? 180;
  const connection: ConnectionInfo = { status: "demo", detail: "Showing sample fixture data." };

  const projects = clone(demoProjects);
  const sessions = clone(demoSessions);
  const snapshots: Record<string, SessionSnapshot> = clone(demoSnapshots);
  const listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  const pendingResume = new Map<string, () => void>();
  const seq = new Map<string, number>();
  // Per-session event log so subscribers can resume from a cursor, like a real stream.
  const log = new Map<string, SessionEvent[]>();

  const wait = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency * Math.min(speed, 1)));

  const emit = (sessionId: string, payload: SessionEventPayload) => {
    const next = (seq.get(sessionId) ?? snapshots[sessionId]?.lastSeq ?? 0) + 1;
    seq.set(sessionId, next);
    const event = { ...payload, sessionId, seq: next, at: new Date().toISOString() } as SessionEvent;
    const snap = snapshots[sessionId];
    if (snap) {
      snapshots[sessionId] = applySessionEvent(snap, event);
      const index = sessions.findIndex((x) => x.id === sessionId);
      if (index !== -1) sessions[index] = snapshots[sessionId]!.session;
    }
    const entries = log.get(sessionId) ?? [];
    entries.push(event);
    log.set(sessionId, entries);
    listeners.get(sessionId)?.forEach((listener) => listener(event));
  };

  const clearTimers = (sessionId: string) => {
    timers.get(sessionId)?.forEach(clearTimeout);
    timers.delete(sessionId);
    pendingResume.delete(sessionId);
  };

  const play = (sessionId: string, steps: Step[]) => {
    clearTimers(sessionId);
    let elapsed = 0;
    const handles: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      elapsed += step.delay * speed;
      if ("waitForApproval" in step) {
        const rest = steps.slice(i + 1);
        pendingResume.set(sessionId, () => play(sessionId, rest));
        break;
      }
      handles.push(setTimeout(() => emit(sessionId, step.event), elapsed));
    }
    timers.set(sessionId, handles);
  };

  const requireSession = (sessionId: string) => {
    const snap = snapshots[sessionId];
    if (!snap) throw new Error(`Unknown demo session ${sessionId}`);
    return snap;
  };

  const startRun = (sessionId: string, text: string) => {
    const snap = requireSession(sessionId);
    const runId = `run${Date.now().toString(36)}`;
    const userId = `${runId}-u`;
    emit(sessionId, { type: "message.started", messageId: userId, role: "user" });
    emit(sessionId, { type: "message.delta", messageId: userId, text });
    emit(sessionId, { type: "message.completed", messageId: userId });
    emit(sessionId, { type: "run.status", status: "queued" });
    play(sessionId, buildScript(text, snap.session.agentId, runId));
  };

  return {
    mode: "demo",
    label: "Demo fixtures",
    getConnection: () => connection,
    onConnectionChange: () => () => {},
    reconnect: () => {},

    listAgents: () => wait(demoAgents),
    listProviders: () => wait(demoProviders),
    listModels: (agentId) =>
      wait((demoProviders.find((p) => p.agentId === agentId)?.availableModels ?? []).map((id, i) => ({ id, name: id, isDefault: i === 0 }))),
    setApiKey: () => Promise.reject(new Error(READ_ONLY)),
    clearApiKey: () => Promise.reject(new Error(READ_ONLY)),
    getPairing: () => Promise.reject(new Error(READ_ONLY)),
    pair: () => Promise.reject(new Error(READ_ONLY)),
    updatePairing: () => Promise.reject(new Error(READ_ONLY)),
    unpair: () => Promise.reject(new Error(READ_ONLY)),
    listProjects: () => wait(projects),
    async addProject(path) {
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      const existing = projects.find((p) => p.path === path);
      if (existing) return clone(existing);
      // Branch is unknown without the runtime's Git backend; show that honestly.
      const project: Project = { id: `p-${Date.now().toString(36)}`, name, path, branch: "unknown", lastOpenedAt: new Date().toISOString() };
      projects.unshift(project);
      return wait(project);
    },

    listSessions: (filter) =>
      wait(
        sessions
          .filter((x) => !filter?.projectId || x.projectId === filter.projectId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),
    getSession: async (sessionId) => wait(requireSession(sessionId)),
    async createSession({ projectId, agentId, model, prompt }) {
      const project = projects.find((p) => p.id === projectId);
      const at = new Date().toISOString();
      const session: SessionSummary = {
        id: `s-${Date.now().toString(36)}`,
        projectId,
        title: prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt,
        agentId,
        model,
        status: "idle",
        branch: project?.branch ?? "unknown",
        createdAt: at,
        updatedAt: at,
        messageCount: 0,
      };
      sessions.unshift(session);
      snapshots[session.id] = { session, timeline: [], changes: [], tests: [], lastSeq: 0 };
      // Start after the caller has had a chance to subscribe.
      setTimeout(() => startRun(session.id, prompt), 250 * speed);
      return wait(session);
    },
    async sendMessage(sessionId, text) {
      startRun(sessionId, text);
    },
    listQueuedMessages: () => wait([]),
    removeQueuedMessage: () => Promise.reject(new Error(READ_ONLY)),
    getAutoApprove: () => wait(false),
    getUsage: () => wait([demoUsage()]),
    setAutoApprove: () => Promise.reject(new Error(READ_ONLY)),
    getDeveloperActivity: () => Promise.reject(new Error(READ_ONLY)),
    updateRepository: () => Promise.reject(new Error(READ_ONLY)),
    getIdeUpdate: () => Promise.reject(new Error(READ_ONLY)),
    openIdeUpdate: () => Promise.reject(new Error(READ_ONLY)),
    ...unsupportedWorkspace(() => new Error(READ_ONLY)),
    async cancelRun(sessionId) {
      requireSession(sessionId);
      clearTimers(sessionId);
      emit(sessionId, { type: "run.status", status: "cancelling" });
      setTimeout(() => {
        emit(sessionId, { type: "run.status", status: "cancelled" });
        emit(sessionId, { type: "notice", text: "Run cancelled.", tone: "warning" });
      }, 200 * speed);
    },
    async resolveApproval(sessionId, approvalId, decision: ApprovalDecision) {
      const snap = requireSession(sessionId);
      const item = snap.timeline.find((x) => x.id === approvalId);
      if (!item || item.kind !== "approval" || item.status !== "pending") {
        throw new Error("This approval request is no longer pending.");
      }
      emit(sessionId, { type: "approval.resolved", approvalId, decision });
      const resume = pendingResume.get(sessionId);
      pendingResume.delete(sessionId);
      if (decision === "reject") {
        emit(sessionId, { type: "notice", text: "Command rejected. The agent will not run it.", tone: "warning" });
        emit(sessionId, { type: "run.status", status: "completed" });
        return;
      }
      emit(sessionId, { type: "run.status", status: "running" });
      if (resume) resume();
      else {
        // Fixture approvals without a scripted continuation end the replay honestly.
        emit(sessionId, { type: "notice", text: "Approved. (Demo: the fixture session has no scripted continuation.)", tone: "neutral" });
        emit(sessionId, { type: "run.status", status: "completed" });
      }
    },
    getDiff: async (sessionId, path) => {
      const diff = demoDiffs[sessionId]?.find((d) => d.path === path);
      if (!diff) throw new Error(`No diff for ${path}`);
      return wait(diff);
    },
    subscribe(sessionId, afterSeq, onEvent): Unsubscribe {
      let set = listeners.get(sessionId);
      if (!set) listeners.set(sessionId, (set = new Set()));
      for (const event of log.get(sessionId) ?? []) if (event.seq > afterSeq) onEvent(event);
      set.add(onEvent);
      return () => set.delete(onEvent);
    },

    listDevices: () => wait(demoDevices),
    listActivity: () => wait(demoActivity),
    remoteActionsAvailable: () => false,
  };
}
