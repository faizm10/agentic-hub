"use client";

import type { TimelineItem } from "../model/types";
import { cn } from "../lib/cn";
import { formatClock } from "../lib/format";
import { TOOL_ICON } from "./tool-execution-card";

/** Condensed chronological log of tool calls and approvals for the side panel. */
export function AgentActivityList({ items }: { items: TimelineItem[] }) {
  const entries = items.filter((i) => i.kind === "tool" || i.kind === "approval" || i.kind === "error");
  if (entries.length === 0) return <p className="px-3 py-6 text-center text-xs text-fg-subtle">No tool activity yet.</p>;
  return (
    <ol className="relative space-y-0.5 px-2" aria-label="Agent activity">
      {entries.map((item) => {
        const Icon = item.kind === "error" ? TOOL_ICON.other : TOOL_ICON[item.tool];
        const at = item.kind === "tool" ? item.startedAt : item.createdAt;
        const title = item.kind === "error" ? item.message : item.title;
        const tone =
          item.kind === "error" || (item.kind === "tool" && item.status === "failed")
            ? "text-danger"
            : item.kind === "approval" && item.status === "pending"
              ? "text-warning"
              : item.kind === "tool" && item.status === "running"
                ? "text-accent"
                : "text-fg-subtle";
        return (
          <li key={item.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
            <span className="min-w-0 flex-1 text-xs leading-snug text-fg-muted">
              <span className="line-clamp-2">{title}</span>
              {item.kind === "approval" ? <span className={cn("text-2xs capitalize", tone)}>{item.status}</span> : null}
            </span>
            <time className="shrink-0 text-2xs tabular-nums text-fg-subtle" dateTime={at}>
              {formatClock(at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}