"use client";

import {
  ChevronRight,
  CircleCheck,
  CircleX,
  FilePen,
  FilePlus,
  FileText,
  FlaskConical,
  Globe,
  LoaderCircle,
  Ban,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import type { ToolItem, ToolKind } from "../model/types";
import { cn } from "../lib/cn";
import { formatDuration } from "../lib/format";

export const TOOL_ICON: Record<ToolKind, typeof Wrench> = {
  shell: SquareTerminal,
  read: FileText,
  edit: FilePen,
  write: FilePlus,
  search: Search,
  web: Globe,
  test: FlaskConical,
  other: Wrench,
};

function StatusIcon({ status }: { status: ToolItem["status"] }) {
  if (status === "running") return <LoaderCircle className="size-3.5 animate-spin text-accent" aria-label="Running" />;
  if (status === "succeeded") return <CircleCheck className="size-3.5 text-success" aria-label="Succeeded" />;
  if (status === "failed") return <CircleX className="size-3.5 text-danger" aria-label="Failed" />;
  return <Ban className="size-3.5 text-fg-subtle" aria-label="Cancelled" />;
}

export function ToolExecutionCard({ item, defaultOpen }: { item: ToolItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? item.status === "failed");
  const Icon = TOOL_ICON[item.tool];
  const hasDetail = Boolean(item.input || item.output);
  const duration =
    item.endedAt && item.startedAt ? new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime() : undefined;

  return (
    <div
      className={cn(
        "max-w-3xl overflow-hidden rounded-lg border bg-surface transition-colors",
        item.status === "failed" ? "border-danger/30" : "border-border",
        item.status === "running" && "border-accent/30",
      )}
      data-status={item.status}
    >
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm focus-ring enabled:hover:bg-surface-2"
      >
        <Icon className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          <span className="text-fg">{item.title}</span>
          {item.tool === "shell" || item.tool === "test" || item.tool === "search" ? (
            item.input ? <span className="ml-2 font-mono text-xs text-fg-subtle">{item.input}</span> : null
          ) : null}
        </span>
        {item.exitCode != null && item.exitCode !== 0 ? (
          <span className="font-mono text-2xs text-danger">exit {item.exitCode}</span>
        ) : null}
        {duration != null ? <span className="text-2xs tabular-nums text-fg-subtle">{formatDuration(duration)}</span> : null}
        <StatusIcon status={item.status} />
        {hasDetail ? <ChevronRight className={cn("size-3 text-fg-subtle transition-transform", open && "rotate-90")} /> : null}
      </button>
      {open && hasDetail ? (
        <div className="border-t border-border bg-surface-2/60 animate-in fade-in-0">
          {item.input ? (
            <div className="flex gap-2 px-3 pt-2 font-mono text-xs text-fg-muted">
              <span className="select-none text-fg-subtle">{item.tool === "shell" || item.tool === "test" || item.tool === "search" ? "$" : "›"}</span>
              <span className="break-all">{item.input}</span>
            </div>
          ) : null}
          {item.output ? (
            <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs leading-5 text-fg-muted">{item.output}</pre>
          ) : (
            <div className="h-2" />
          )}
        </div>
      ) : null}
    </div>
  );
}