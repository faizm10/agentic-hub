"use client";

import { History, Plus, Search, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AGENT_DISPLAY } from "../model/agents";
import type { ConnectionInfo, Project, ProviderConfig, SessionSummary } from "../model/types";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Kbd } from "../primitives/kbd";
import { SegmentedControl } from "../primitives/form";
import { Tooltip } from "../primitives/tooltip";
import { AgentMark } from "./agent-mark";
import { ProjectSwitcher } from "./project-switcher";
import { SessionList, SessionListSkeleton, type SessionGrouping } from "./session-list";

const PROVIDER_DOT: Record<ProviderConfig["status"], string> = {
  ready: "bg-success",
  needs_auth: "bg-warning",
  not_installed: "bg-fg-subtle",
  error: "bg-danger",
  unknown: "bg-fg-subtle",
};

const CONNECTION_LABEL: Record<ConnectionInfo["status"], { label: string; dot: string }> = {
  demo: { label: "Demo mode", dot: "bg-info" },
  connecting: { label: "Connecting…", dot: "bg-fg-subtle animate-pulse-dot" },
  connected: { label: "Runtime connected", dot: "bg-success" },
  reconnecting: { label: "Reconnecting…", dot: "bg-warning animate-pulse-dot" },
  disconnected: { label: "Runtime offline", dot: "bg-danger" },
};

export interface ProjectSidebarProps {
  projects: Project[];
  sessions: SessionSummary[];
  providers?: ProviderConfig[];
  connection: ConnectionInfo;
  activeProjectId?: string;
  activeSessionId?: string;
  loading?: boolean;
  /** Shown instead of the list when sessions can't be loaded. */
  sessionsUnavailable?: string;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession?: () => void;
  onOpenRepository?: () => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onOpenProviders?: () => void;
  /** Rendered above the switcher (e.g. a desktop drag region spacer). */
  header?: ReactNode;
  className?: string;
}

export function ProjectSidebar({
  projects,
  sessions,
  providers,
  connection,
  activeProjectId,
  activeSessionId,
  loading,
  sessionsUnavailable,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onOpenRepository,
  onOpenSettings,
  onOpenHistory,
  onOpenProviders,
  header,
  className,
}: ProjectSidebarProps) {
  const [filter, setFilter] = useState("");
  const [grouping, setGrouping] = useState<SessionGrouping>("project");
  const conn = CONNECTION_LABEL[connection.status];

  return (
    <aside aria-label="Projects and sessions" className={cn("flex h-full min-h-0 flex-col bg-surface", className)}>
      {header}
      <div className="space-y-2 px-2 pb-2 pt-1">
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onOpenRepository={onOpenRepository}
        />
        <Button variant="secondary" className="w-full justify-start" onClick={onNewSession} disabled={!onNewSession || !activeProjectId}>
          <Plus /> <span className="flex-1 text-left">New session</span>
          <Kbd keys="mod+n" />
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sessions"
            aria-label="Filter sessions"
            className="h-7 w-full rounded-md border border-transparent bg-surface-2 pl-7 pr-2 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-border focus-visible:border-accent focus-visible:outline-none"
          />
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-1.5 pt-1">
        <span className="text-2xs font-medium uppercase tracking-[0.06em] text-fg-subtle">Sessions</span>
        <SegmentedControl
          label="Group sessions by"
          value={grouping}
          onChange={setGrouping}
          options={[
            { value: "project", label: "Project" },
            { value: "date", label: "Date" },
          ]}
          className="scale-90 origin-right"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {sessionsUnavailable ? (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">{sessionsUnavailable}</p>
        ) : loading ? (
          <SessionListSkeleton />
        ) : (
          <SessionList
            sessions={sessions}
            projects={projects}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            grouping={grouping}
            filter={filter}
          />
        )}
      </div>
      <footer className="space-y-1 border-t border-border p-2">
        {providers?.length ? (
          <button
            type="button"
            onClick={onOpenProviders}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 focus-ring"
            aria-label="Provider status"
          >
            {providers.map((p) => (
              <Tooltip key={p.agentId} content={`${AGENT_DISPLAY[p.agentId].name}: ${p.status.replace("_", " ")}`} side="top">
                <span className="relative">
                  <AgentMark agentId={p.agentId} size="sm" />
                  <span className={cn("absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-surface", PROVIDER_DOT[p.status])} />
                </span>
              </Tooltip>
            ))}
            <span className="ml-auto">Providers</span>
          </button>
        ) : null}
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-xs text-fg-muted" role="status">
            <span className={cn("size-1.5 shrink-0 rounded-full", conn.dot)} />
            <span className="truncate">{conn.label}</span>
          </div>
          {onOpenHistory ? (
            <Tooltip content="Session history" shortcut="mod+y" side="top">
              <Button variant="ghost" size="icon" aria-label="Session history" onClick={onOpenHistory}>
                <History />
              </Button>
            </Tooltip>
          ) : null}
          {onOpenSettings ? (
            <Tooltip content="Settings" shortcut="mod+," side="top">
              <Button variant="ghost" size="icon" aria-label="Settings" onClick={onOpenSettings}>
                <Settings />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </footer>
    </aside>
  );
}