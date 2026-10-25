"use client";

import { CircleAlert, Info, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { AgentId, ApprovalDecision, RunStatus, TimelineItem } from "../model/types";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { ApprovalRequestCard } from "./approval-request-card";
import { ChatMessage, MessageSkeleton } from "./chat-message";
import { ReasoningSummary } from "./reasoning-summary";
import { ToolExecutionCard } from "./tool-execution-card";

export interface AgentEventTimelineProps {
  items: TimelineItem[];
  /** Shown beside assistant messages. */
  agentId?: AgentId;
  status?: RunStatus;
  loading?: boolean;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => Promise<unknown>;
  approvalUnavailableReason?: string;
  onRetry?: () => void;
  empty?: ReactNode;
  className?: string;
}

function TimelineRow({
  item,
  agentId,
  onResolveApproval,
  approvalUnavailableReason,
  onRetry,
}: {
  item: TimelineItem;
  agentId?: AgentId;
  onResolveApproval?: AgentEventTimelineProps["onResolveApproval"];
  approvalUnavailableReason?: string;
  onRetry?: () => void;
}) {
  switch (item.kind) {
    case "message":
      return <ChatMessage message={item} agentId={agentId} />;
    case "reasoning":
      return <ReasoningSummary item={item} />;
    case "tool":
      return <ToolExecutionCard item={item} />;
    case "approval":
      return (
        <ApprovalRequestCard
          item={item}
          unavailableReason={approvalUnavailableReason}
          onResolve={onResolveApproval ? (decision) => onResolveApproval(item.id, decision) : undefined}
        />
      );
    case "notice":
      return (
        <div
          className={cn(
            "flex max-w-3xl items-center gap-2 text-xs",
            item.tone === "warning" && "text-warning",
            item.tone === "danger" && "text-danger",
            item.tone === "success" && "text-success",
            item.tone === "neutral" && "text-fg-subtle",
          )}
        >
          <Info className="size-3.5 shrink-0" />
          <span>{item.text}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "error":
      return (
        <div role="alert" className="flex max-w-3xl items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="flex-1 text-sm text-fg">{item.message}</p>
          {item.retryable && onRetry ? (
            <Button size="xs" variant="secondary" onClick={onRetry}>
              <RefreshCw /> Retry
            </Button>
          ) : null}
        </div>
      );
  }
}

function WorkingIndicator({ status }: { status: RunStatus }) {
  const label = status === "queued" ? "Queued" : status === "cancelling" ? "Cancelling…" : "Working";
  return (
    <div className="flex items-center gap-2.5 pl-0.5 text-sm text-fg-subtle" role="status" aria-live="polite">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-fg-subtle animate-pulse-dot" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      {label}
    </div>
  );
}

/** Scrollable stream of messages, reasoning, tool calls and approvals with stick-to-bottom behaviour. */
export function AgentEventTimeline({
  items,
  agentId,
  status,
  loading,
  onResolveApproval,
  approvalUnavailableReason,
  onRetry,
  empty,
  className,
}: AgentEventTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });

  const last = items.at(-1);
  const streamingNow = last && ((last.kind === "message" && last.streaming) || (last.kind === "reasoning" && last.streaming) || (last.kind === "tool" && last.status === "running"));
  const showWorking = status && (status === "queued" || status === "running" || status === "cancelling") && !streamingNow;

  return (
    <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div
        className="mx-auto flex w-full max-w-[48rem] flex-col gap-6 px-4 py-8 sm:px-6"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={loading || undefined}
      >
        {loading ? (
          <>
            <div className="ml-auto h-11 w-2/5 rounded-3xl skeleton" />
            <MessageSkeleton />
            <div className="h-8 w-3/5 rounded-lg skeleton" />
            <MessageSkeleton className="w-4/5" />
          </>
        ) : items.length === 0 ? (
          empty
        ) : (
          items.map((item) => (
            <div key={item.id} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
              <TimelineRow
                item={item}
                agentId={agentId}
                onResolveApproval={onResolveApproval}
                approvalUnavailableReason={approvalUnavailableReason}
                onRetry={onRetry}
              />
            </div>
          ))
        )}
        {showWorking ? <WorkingIndicator status={status} /> : null}
      </div>
    </div>
  );
}