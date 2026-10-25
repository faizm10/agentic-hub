"use client";

import type { RunStatus } from "../model/types";
import { cn } from "../lib/cn";

const STATUS: Record<RunStatus, { label: string; dot: string; text: string; pulse?: boolean }> = {
  idle: { label: "Idle", dot: "bg-fg-subtle/60", text: "text-fg-subtle" },
  queued: { label: "Queued", dot: "bg-fg-subtle", text: "text-fg-muted", pulse: true },
  running: { label: "Running", dot: "bg-accent", text: "text-accent", pulse: true },
  awaiting_approval: { label: "Needs approval", dot: "bg-warning", text: "text-warning", pulse: true },
  cancelling: { label: "Cancelling", dot: "bg-warning", text: "text-warning", pulse: true },
  cancelled: { label: "Cancelled", dot: "bg-fg-subtle", text: "text-fg-subtle" },
  completed: { label: "Completed", dot: "bg-success", text: "text-success" },
  failed: { label: "Failed", dot: "bg-danger", text: "text-danger" },
  interrupted: { label: "Interrupted", dot: "bg-warning", text: "text-warning" },
};

export function runStatusLabel(status: RunStatus) {
  return STATUS[status].label;
}

export function RunStatusIndicator({
  status,
  showLabel = true,
  className,
}: {
  status: RunStatus;
  showLabel?: boolean;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", s.text, className)}
      role="status"
      aria-label={showLabel ? undefined : s.label}
      title={showLabel ? undefined : s.label}
    >
      <span className="relative inline-flex size-2 items-center justify-center">
        {s.pulse ? <span className={cn("absolute inset-0 rounded-full opacity-40 animate-ping", s.dot)} /> : null}
        <span className={cn("relative size-1.5 rounded-full", s.dot)} />
      </span>
      {showLabel ? s.label : null}
    </span>
  );
}