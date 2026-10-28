import type {
  ApprovalDecision,
  ApprovalItem,
  FileChange,
  RunStatus,
  SessionSnapshot,
  TestRun,
  TimelineItem,
  ToolKind,
  ToolStatus,
} from "./types";

/**
 * Provisional stream event vocabulary used by the UI reducer. A backend
 * adapter translates the real event stream into these.
 */
export type SessionEventPayload =
  | { type: "message.started"; messageId: string; role: "user" | "assistant" }
  | { type: "message.delta"; messageId: string; text: string }
  | { type: "message.completed"; messageId: string }
  | { type: "reasoning.delta"; reasoningId: string; text: string }
  | { type: "reasoning.completed"; reasoningId: string; durationMs?: number }
  | { type: "tool.started"; toolId: string; tool: ToolKind; title: string; input?: string }
  | { type: "tool.output"; toolId: string; chunk: string }
  | { type: "tool.completed"; toolId: string; status: ToolStatus; exitCode?: number }
  | { type: "approval.requested"; approval: Omit<ApprovalItem, "kind" | "status" | "createdAt"> }
  | { type: "approval.resolved"; approvalId: string; decision: ApprovalDecision | "expired" }
  | { type: "run.status"; status: RunStatus }
  | { type: "files.changed"; changes: FileChange[] }
  /** Token usage for one model; `cumulative` values replace the running total. */
  | { type: "usage"; model: string; inputTokens: number; outputTokens: number; costUsd: number | null; cumulative: boolean }
  | { type: "tests.updated"; run: TestRun }
  | { type: "notice"; text: string; tone: "neutral" | "warning" | "danger" | "success" }
  | { type: "error"; message: string; retryable?: boolean }
  /**
   * Several view updates that share one backend sequence number. The runtime
   * sends complete snapshot events (e.g. a whole message), which map to more
   * than one reducer step but must be de-duplicated as a unit.
   */
  | { type: "batch"; events: SessionEventPayload[] };

/**
 * Partial streamed text. Ephemeral: it carries no sequence number, never
 * advances `lastSeq`, and is replaced by the persisted message that follows.
 */
export interface StreamDeltaEvent {
  type: "stream.delta";
  sessionId: string;
  streamId: string;
  kind: "text" | "reasoning";
  text: string;
  at: string;
}

export type SessionEvent = SessionEventPayload & {
  sessionId: string;
  /** Monotonic per-session sequence; used to de-duplicate replays after reconnect. */
  seq: number;
  at: string;
};

function upsert(timeline: TimelineItem[], id: string, update: (prev: TimelineItem | undefined) => TimelineItem) {
  const index = timeline.findIndex((item) => item.id === id);
  if (index === -1) return [...timeline, update(undefined)];
  const next = timeline.slice();
  next[index] = update(timeline[index]);
  return next;
}

/**
 * Pure reducer folding a stream event into a session snapshot. Events with a
 * sequence number at or below `lastSeq` are ignored, so a reconnecting stream
 * can safely replay from an earlier cursor.
 */
export const STREAM_PREFIX = "stream:";
const isEphemeral = (item: TimelineItem) => item.id.startsWith(STREAM_PREFIX);

/** Folds an ephemeral delta into a streaming placeholder item. */
export function applyStreamDelta(state: SessionSnapshot, delta: StreamDeltaEvent): SessionSnapshot {
  const id = `${STREAM_PREFIX}${delta.streamId}`;
  return {
    ...state,
    timeline: upsert(state.timeline, id, (prev) =>
      delta.kind === "text"
        ? { kind: "message", id, role: "assistant", text: (prev?.kind === "message" ? prev.text : "") + delta.text, createdAt: prev && "createdAt" in prev ? prev.createdAt : delta.at, streaming: true }
        : { kind: "reasoning", id, summary: (prev?.kind === "reasoning" ? prev.summary : "") + delta.text, createdAt: prev && "createdAt" in prev ? prev.createdAt : delta.at, streaming: true },
    ),
  };
}

export function applySessionEvent(state: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  if (event.seq <= state.lastSeq) return state;
  if (event.type === "batch") {
    const { sessionId, seq, at } = event;
    return event.events.reduce<SessionSnapshot>(
      (next, payload) => foldEvent(next, { ...payload, sessionId, seq, at } as SessionEvent),
      { ...state, lastSeq: seq },
    );
  }
  return foldEvent(state, event);
}

function foldEvent(state: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  const base = { ...state, lastSeq: event.seq };
  const at = event.at;

  switch (event.type) {
    case "message.started":
      return {
        ...base,
        timeline: upsert(
          event.role === "assistant" ? state.timeline.filter((item) => !(isEphemeral(item) && item.kind === "message")) : state.timeline,
          event.messageId,
          () => ({
          kind: "message",
          id: event.messageId,
          role: event.role,
          text: "",
          createdAt: at,
          streaming: true,
        }),
        ),
        session: { ...state.session, messageCount: state.session.messageCount + 1, updatedAt: at },
      };
    case "message.delta":
      return {
        ...base,
        timeline: upsert(state.timeline, event.messageId, (prev) =>
          prev?.kind === "message"
            ? { ...prev, text: prev.text + event.text }
            : { kind: "message", id: event.messageId, role: "assistant", text: event.text, createdAt: at, streaming: true },
        ),
      };
    case "message.completed":
      return {
        ...base,
        timeline: state.timeline.map((item) =>
          item.id === event.messageId && item.kind === "message" ? { ...item, streaming: false } : item,
        ),
      };
    case "reasoning.delta":
      return {
        ...base,
        timeline: upsert(state.timeline.filter((item) => !(isEphemeral(item) && item.kind === "reasoning")), event.reasoningId, (prev) =>
          prev?.kind === "reasoning"
            ? { ...prev, summary: prev.summary + event.text }
            : { kind: "reasoning", id: event.reasoningId, summary: event.text, createdAt: at, streaming: true },
        ),
      };
    case "reasoning.completed":
      return {
        ...base,
        timeline: state.timeline.map((item) =>
          item.id === event.reasoningId && item.kind === "reasoning"
            ? { ...item, streaming: false, durationMs: event.durationMs }
            : item,
        ),
      };
    case "tool.started":
      return {
        ...base,
        timeline: upsert(state.timeline, event.toolId, () => ({
          kind: "tool",
          id: event.toolId,
          tool: event.tool,
          title: event.title,
          input: event.input,
          status: "running",
          startedAt: at,
        })),
      };
    case "tool.output":
      return {
        ...base,
        timeline: state.timeline.map((item) =>
          item.id === event.toolId && item.kind === "tool"
            ? { ...item, output: (item.output ?? "") + event.chunk }
            : item,
        ),
      };
    case "tool.completed":
      return {
        ...base,
        timeline: state.timeline.map((item) =>
          item.id === event.toolId && item.kind === "tool"
            ? { ...item, status: event.status, exitCode: event.exitCode, endedAt: at }
            : item,
        ),
      };
    case "approval.requested":
      return {
        ...base,
        timeline: upsert(state.timeline, event.approval.id, () => ({
          ...event.approval,
          kind: "approval",
          status: "pending",
          createdAt: at,
        })),
      };
    case "approval.resolved":
      return {
        ...base,
        timeline: state.timeline.map((item) =>
          item.id === event.approvalId && item.kind === "approval"
            ? {
                ...item,
                status:
                  event.decision === "approve" ? "approved" : event.decision === "reject" ? "rejected" : "expired",
                resolvedAt: at,
              }
            : item,
        ),
      };
    case "run.status": {
      const terminal =
        event.status === "cancelled" || event.status === "failed" || event.status === "completed" || event.status === "interrupted";
      return {
        ...base,
        session: { ...state.session, status: event.status, updatedAt: at },
        // A terminal run status closes anything still marked as streaming/running.
        timeline: terminal
          ? state.timeline.filter((item) => !isEphemeral(item)).map((item) => {
              if (item.kind === "message" && item.streaming) return { ...item, streaming: false };
              if (item.kind === "reasoning" && item.streaming) return { ...item, streaming: false };
              if (item.kind === "tool" && item.status === "running")
                return { ...item, status: "cancelled" as const, endedAt: at };
              if (item.kind === "approval" && item.status === "pending")
                return { ...item, status: "expired" as const, resolvedAt: at };
              return item;
            })
          : state.timeline,
      };
    }
    case "files.changed":
      return { ...base, changes: event.changes };
    case "usage": {
      const prev = state.usage?.[event.model];
      const next = event.cumulative || !prev
        ? { inputTokens: event.inputTokens, outputTokens: event.outputTokens, costUsd: event.costUsd }
        : { inputTokens: prev.inputTokens + event.inputTokens, outputTokens: prev.outputTokens + event.outputTokens, costUsd: event.costUsd === null ? prev.costUsd : (prev.costUsd ?? 0) + event.costUsd };
      return { ...base, usage: { ...state.usage, [event.model]: next } };
    }
    case "tests.updated": {
      const exists = state.tests.some((run) => run.id === event.run.id);
      return {
        ...base,
        tests: exists ? state.tests.map((run) => (run.id === event.run.id ? event.run : run)) : [...state.tests, event.run],
      };
    }
    case "notice":
      return {
        ...base,
        timeline: [
          ...state.timeline,
          { kind: "notice", id: `notice-${event.seq}`, text: event.text, tone: event.tone, createdAt: at },
        ],
      };
    case "error":
      return {
        ...base,
        timeline: [
          ...state.timeline,
          { kind: "error", id: `error-${event.seq}`, message: event.message, retryable: event.retryable, createdAt: at },
        ],
      };
    case "batch":
      return event.events.reduce<SessionSnapshot>(
        (next, payload) => foldEvent(next, { ...payload, sessionId: event.sessionId, seq: event.seq, at } as SessionEvent),
        base,
      );
  }
}

export function isRunActive(status: RunStatus) {
  return status === "queued" || status === "running" || status === "awaiting_approval" || status === "cancelling";
}

export function pendingApprovals(timeline: TimelineItem[]) {
  return timeline.filter((item): item is ApprovalItem => item.kind === "approval" && item.status === "pending");
}
