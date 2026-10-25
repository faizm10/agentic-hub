"use client";

import { useMemo } from "react";
import type { Project, SessionSummary } from "../model/types";
import { cn } from "../lib/cn";
import { dayBucket, formatRelative } from "../lib/format";
import { AgentMark } from "./agent-mark";
import { RunStatusIndicator } from "./run-status-indicator";

const BUCKET_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

export type SessionGrouping = "project" | "date";

export function groupSessions(
  sessions: SessionSummary[],
  grouping: SessionGrouping,
  projects: Project[] = [],
  now: Date = new Date(),
) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = new Map<string, { key: string; label: string; sessions: SessionSummary[] }>();
  for (const session of sorted) {
    const key = grouping === "project" ? session.projectId : dayBucket(session.updatedAt, now);
    const label = grouping === "project" ? (projects.find((p) => p.id === key)?.name ?? "Unknown project") : key;
    if (!groups.has(key)) groups.set(key, { key, label, sessions: [] });
    groups.get(key)!.sessions.push(session);
  }
  const list = [...groups.values()];
  if (grouping === "date") list.sort((a, b) => BUCKET_ORDER.indexOf(a.key) - BUCKET_ORDER.indexOf(b.key));
  return list;
}

export function SessionListItem({
  session,
  active,
  onSelect,
  showProject,
  projectName,
}: {
  session: SessionSummary;
  active?: boolean;
  onSelect?: (id: string) => void;
  showProject?: boolean;
  projectName?: string;
}) {
  const live = session.status === "running" || session.status === "awaiting_approval" || session.status === "queued" || session.status === "cancelling";
  return (
    <button
      type="button"
      onClick={() => onSelect?.(session.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-ring",
        active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-3/70 hover:text-fg",
      )}
    >
      <AgentMark agentId={session.agentId} size="sm" />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", active && "font-medium")}>{session.title}</span>
        {showProject && projectName ? <span className="block truncate text-2xs text-fg-subtle">{projectName}</span> : null}
      </span>
      {live || session.status === "failed" ? (
        <RunStatusIndicator status={session.status} showLabel={false} />
      ) : (
        <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{formatRelative(session.updatedAt)}</span>
      )}
    </button>
  );
}

export function SessionList({
  sessions,
  projects,
  activeSessionId,
  onSelect,
  grouping = "project",
  filter,
  className,
}: {
  sessions: SessionSummary[];
  projects?: Project[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  grouping?: SessionGrouping;
  filter?: string;
  className?: string;
}) {
  const groups = useMemo(() => {
    const q = filter?.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
    return groupSessions(filtered, grouping, projects);
  }, [sessions, grouping, projects, filter]);

  if (groups.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-fg-subtle">{filter ? "No chats match." : "No chats yet. Start one above."}</p>;
  }

  return (
    <nav aria-label="Sessions" className={cn("space-y-4", className)}>
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.label}>
          <div className="px-2.5 pb-1 text-2xs font-medium text-fg-subtle">{group.label}</div>
          <div className="space-y-px">
            {group.sessions.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={onSelect}
                showProject={grouping === "date"}
                projectName={projects?.find((p) => p.id === session.projectId)?.name}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SessionListSkeleton() {
  return (
    <div className="space-y-2 px-2" aria-label="Loading sessions">
      <div className="skeleton h-2.5 w-16" />
      {[70, 85, 60, 78].map((w, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <div className="skeleton size-4" />
          <div className="skeleton h-3" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}