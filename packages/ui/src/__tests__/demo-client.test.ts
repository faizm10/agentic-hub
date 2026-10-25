import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_NOTICE, createDemoClient } from "../fixtures/demo-client";
import { applySessionEvent, pendingApprovals, type SessionEvent } from "../model/events";
import type { SessionSnapshot } from "../model/types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function start(prompt = "Do a thing") {
  const client = createDemoClient({ speed: 1, latencyMs: 0 });
  const created = client.createSession({ projectId: "p-hub", agentId: "codex", prompt });
  await vi.runOnlyPendingTimersAsync();
  const session = await created;
  const snapPromise = client.getSession(session.id);
  await vi.runOnlyPendingTimersAsync();
  let snap = await snapPromise;
  const events: SessionEvent[] = [];
  client.subscribe(session.id, snap.lastSeq, (e) => {
    events.push(e);
    snap = applySessionEvent(snap, e);
  });
  return { client, session, events, get snap(): SessionSnapshot { return snap; } };
}

describe("demo client", () => {
  it("labels every replay and pauses for approval", async () => {
    const run = await start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.snap.timeline.some((i) => i.kind === "notice" && i.text === DEMO_NOTICE)).toBe(true);
    expect(run.snap.session.status).toBe("awaiting_approval");
    expect(run.client.mode).toBe("demo");
    expect(run.client.remoteActionsAvailable()).toBe(false);
  });

  it("continues after approval and completes", async () => {
    const run = await start();
    await vi.advanceTimersByTimeAsync(10_000);
    const approval = run.snap.timeline.find((i) => i.kind === "approval")!;
    await run.client.resolveApproval(run.session.id, approval.id, "approve");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.snap.session.status).toBe("completed");
    expect(run.snap.timeline.find((i) => i.id === approval.id)).toMatchObject({ status: "approved" });
  });

  it("refuses to resolve an approval twice", async () => {
    const run = await start();
    await vi.advanceTimersByTimeAsync(10_000);
    const approval = run.snap.timeline.find((i) => i.kind === "approval")!;
    await run.client.resolveApproval(run.session.id, approval.id, "reject");
    await expect(run.client.resolveApproval(run.session.id, approval.id, "approve")).rejects.toThrow(/no longer pending/);
    expect(run.snap.session.status).toBe("completed");
  });

  it("cancels an in-flight run", async () => {
    const run = await start();
    await vi.advanceTimersByTimeAsync(300);
    await run.client.cancelRun(run.session.id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.snap.session.status).toBe("cancelled");
    // Anything still pending when the run stops is expired, never left actionable.
    expect(pendingApprovals(run.snap.timeline)).toHaveLength(0);
    expect(run.snap.timeline.some((i) => i.kind === "message" && i.streaming)).toBe(false);
  });
});
