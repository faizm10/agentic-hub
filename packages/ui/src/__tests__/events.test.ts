import { describe, expect, it } from "vitest";
import { applySessionEvent, isRunActive, pendingApprovals, type SessionEvent, type SessionEventPayload } from "../model/events";
import type { SessionSnapshot } from "../model/types";

const base = (): SessionSnapshot => ({
  session: {
    id: "s1",
    projectId: "p1",
    title: "t",
    agentId: "codex",
    status: "idle",
    branch: "main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    messageCount: 0,
  },
  timeline: [],
  changes: [],
  tests: [],
  lastSeq: 0,
});

let seq = 0;
const ev = (payload: SessionEventPayload, s = ++seq): SessionEvent => ({ ...payload, sessionId: "s1", seq: s, at: `2026-01-01T00:00:${String(s).padStart(2, "0")}Z` }) as SessionEvent;
const fold = (events: SessionEvent[], start = base()) => events.reduce(applySessionEvent, start);

describe("applySessionEvent", () => {
  it("streams assistant text into a single message", () => {
    seq = 0;
    const state = fold([
      ev({ type: "message.started", messageId: "m", role: "assistant" }),
      ev({ type: "message.delta", messageId: "m", text: "Hel" }),
      ev({ type: "message.delta", messageId: "m", text: "lo" }),
    ]);
    expect(state.timeline).toEqual([expect.objectContaining({ kind: "message", text: "Hello", streaming: true })]);
    const done = applySessionEvent(state, ev({ type: "message.completed", messageId: "m" }));
    expect(done.timeline[0]).toMatchObject({ streaming: false });
    expect(done.session.messageCount).toBe(1);
  });

  it("ignores replayed events at or below lastSeq (reconnect safety)", () => {
    seq = 0;
    const first = ev({ type: "message.delta", messageId: "m", text: "a" });
    const state = fold([first]);
    const replayed = applySessionEvent(state, first);
    expect(replayed).toBe(state);
    expect(replayed.timeline[0]).toMatchObject({ text: "a" });
  });

  it("accumulates tool output and records completion", () => {
    seq = 0;
    const state = fold([
      ev({ type: "tool.started", toolId: "t", tool: "shell", title: "ls", input: "ls" }),
      ev({ type: "tool.output", toolId: "t", chunk: "a\n" }),
      ev({ type: "tool.output", toolId: "t", chunk: "b\n" }),
      ev({ type: "tool.completed", toolId: "t", status: "failed", exitCode: 2 }),
    ]);
    expect(state.timeline[0]).toMatchObject({ kind: "tool", output: "a\nb\n", status: "failed", exitCode: 2 });
  });

  it("tracks approvals through the backend's resolution event", () => {
    seq = 0;
    const requested = fold([
      ev({ type: "approval.requested", approval: { id: "a", tool: "shell", title: "Run tests", risk: "medium" } }),
      ev({ type: "run.status", status: "awaiting_approval" }),
    ]);
    expect(pendingApprovals(requested.timeline)).toHaveLength(1);
    expect(isRunActive(requested.session.status)).toBe(true);
    const resolved = applySessionEvent(requested, ev({ type: "approval.resolved", approvalId: "a", decision: "reject" }));
    expect(resolved.timeline[0]).toMatchObject({ status: "rejected" });
    expect(pendingApprovals(resolved.timeline)).toHaveLength(0);
  });

  it("closes in-flight items when the run reaches a terminal status", () => {
    seq = 0;
    const state = fold([
      ev({ type: "message.delta", messageId: "m", text: "partial" }),
      ev({ type: "tool.started", toolId: "t", tool: "shell", title: "sleep" }),
      ev({ type: "approval.requested", approval: { id: "a", tool: "shell", title: "x", risk: "low" } }),
      ev({ type: "run.status", status: "cancelled" }),
    ]);
    expect(state.session.status).toBe("cancelled");
    expect(state.timeline.map((i) => ("status" in i ? i.status : i.kind === "message" ? i.streaming : null))).toEqual([false, "cancelled", "expired"]);
  });

  it("replaces test runs by id and stores file changes", () => {
    seq = 0;
    const run = { id: "r", name: "unit", status: "running" as const, passed: 0, failed: 0, skipped: 0 };
    const state = fold([
      ev({ type: "tests.updated", run }),
      ev({ type: "tests.updated", run: { ...run, status: "passed", passed: 3 } }),
      ev({ type: "files.changed", changes: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }] }),
    ]);
    expect(state.tests).toEqual([expect.objectContaining({ status: "passed", passed: 3 })]);
    expect(state.changes).toHaveLength(1);
  });
});
