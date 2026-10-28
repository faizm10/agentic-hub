"use client";

import { useState, type ReactNode } from "react";
import { errorMessage, useCancelRun, useClient, useQueuedMessages, useResolveApproval, useSessionStream } from "../client";
import { cn } from "../lib/cn";
import { AGENT_DISPLAY } from "../model/agents";
import { isRunActive } from "../model/events";
import { Button } from "../primitives/button";
import { AgentEventTimeline } from "./agent-event-timeline";
import { AgentMark } from "./agent-mark";
import { ChatComposer } from "./chat-composer";
import { RunStatusIndicator } from "./run-status-indicator";
import { formatTokens } from "./usage-dashboard";

function Column({ sessionId, onOpen, controlReason }: { sessionId: string; onOpen?: (sessionId: string) => void; controlReason?: string }) {
  const snapshot = useSessionStream(sessionId);
  const cancel = useCancelRun(sessionId);
  const resolve = useResolveApproval(sessionId);
  const queue = useQueuedMessages(sessionId);
  const session = snapshot.data?.session;
  const usage = Object.values(snapshot.data?.usage ?? {}).reduce((t, u) => ({ tokens: t.tokens + u.inputTokens + u.outputTokens, cost: u.costUsd === null ? t.cost : (t.cost ?? 0) + u.costUsd }), { tokens: 0, cost: null as number | null });
  const needsInput = session?.status === "awaiting_approval";
  return (
    <section aria-label={session ? AGENT_DISPLAY[session.agentId].name : "Agent"} className={cn("flex min-h-0 min-w-[300px] flex-1 flex-col overflow-hidden rounded-xl border bg-surface", needsInput ? "border-warning/60" : "border-border")}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {session ? <AgentMark agentId={session.agentId} size="sm" /> : null}
        <span className="truncate text-sm font-medium">{session ? AGENT_DISPLAY[session.agentId].name : "Loading…"}</span>
        {session?.model ? <span className="truncate font-mono text-2xs text-fg-subtle">{session.model}</span> : null}
        {session ? <RunStatusIndicator status={session.status} /> : null}
        <span className="flex-1" />
        {usage.tokens ? <span className="text-2xs tabular-nums text-fg-subtle" title="Tokens reported by the provider">{formatTokens(usage.tokens)} tok{usage.cost !== null ? ` · $${usage.cost.toFixed(2)}` : ""}</span> : null}
        {session && isRunActive(session.status) && !controlReason ? (
          <Button size="xs" variant="ghost" onClick={() => cancel.mutate()}>Stop</Button>
        ) : null}
        {onOpen ? <Button size="xs" variant="ghost" onClick={() => onOpen(sessionId)}>Open</Button> : null}
      </header>
      {session?.worktree ? <p className="truncate border-b border-border px-3 py-1 font-mono text-2xs text-fg-subtle">{session.worktree.branch}</p> : null}
      <AgentEventTimeline
        className="min-h-0 flex-1"
        items={snapshot.data?.timeline ?? []}
        agentId={session?.agentId}
        status={session?.status}
        loading={snapshot.isPending}
        approvalUnavailableReason={controlReason}
        onResolveApproval={controlReason ? undefined : (approvalId, decision) => resolve.mutateAsync({ approvalId, decision })}
      />
      {queue.data?.length ? <p className="border-t border-border px-3 py-1 text-2xs text-fg-muted">{queue.data.length} queued</p> : null}
      {snapshot.isError ? <p className="border-t border-border px-3 py-2 text-xs text-danger">{errorMessage(snapshot.error)}</p> : null}
    </section>
  );
}

export interface MultiAgentBoardProps {
  sessionIds: string[];
  /** Opens one session full-size. */
  onOpenSession?: (sessionId: string) => void;
  /** Why actions are unavailable for a session (e.g. web control off). */
  controlReason?: (sessionId: string) => string | undefined;
  header?: ReactNode;
}

/**
 * Several agents side by side, each streaming live. A follow-up goes to every
 * agent at once and queues behind any turn still running.
 */
export function MultiAgentBoard({ sessionIds, onOpenSession, controlReason, header }: MultiAgentBoardProps) {
  const client = useClient();
  const [error, setError] = useState<string | null>(null);
  const writable = sessionIds.filter((id) => !controlReason?.(id));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {sessionIds.map((id) => (
          <Column key={id} sessionId={id} onOpen={onOpenSession} controlReason={controlReason?.(id)} />
        ))}
      </div>
      <ChatComposer
        queueWhileRunning
        placeholder={`Send a follow-up to all ${writable.length} agents…`}
        disabledReason={writable.length ? undefined : controlReason?.(sessionIds[0] ?? "")}
        footer={error ? <span className="text-danger">{error}</span> : <span>Each agent gets the message; busy agents queue it.</span>}
        onSubmit={async (text) => {
          setError(null);
          const results = await Promise.allSettled(writable.map((id) => client.sendMessage(id, text)));
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed) setError(`${failed} of ${writable.length} agents didn't get the message.`);
        }}
      />
    </div>
  );
}
