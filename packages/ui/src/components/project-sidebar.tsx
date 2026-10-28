"use client";

import { Activity, Code2, History, KeyRound, MessageSquareText, Search, Settings, SquarePen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AGENT_DISPLAY } from "../model/agents";
import type { ConnectionInfo, Project, ProviderConfig, SessionSummary } from "../model/types";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Kbd } from "../primitives/kbd";
import { Tooltip } from "../primitives/tooltip";
import { AgentMark } from "./agent-mark";
import { ProjectSwitcher } from "./project-switcher";
import { SessionList, SessionListSkeleton } from "./session-list";

const PROVIDER_DOT: Record<ProviderConfig["status"], string> = {
  ready: "bg-success",
  needs_auth: "bg-warning",
  not_installed: "bg-fg-subtle/60",
  error: "bg-danger",
  unknown: "bg-fg-subtle",
};

export const CONNECTION_LABEL: Record<ConnectionInfo["status"], { label: string; dot: string }> = {
  demo: { label: "Sample data", dot: "bg-info" },
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
  onNewModelSession?: () => void;
  onOpenRepository?: () => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onOpenProviders?: () => void;
  onOpenActivity?: () => void;
  /** Files, editor and terminal (desktop). */
  onOpenCode?: () => void;
  /** Rendered above everything (e.g. a desktop drag region spacer). */
  header?: ReactNode;
  /** Rendered at the very bottom, e.g. an account menu. */
  footer?: ReactNode;
  /** Overrides the status label when connected, e.g. on the web. */
  connectedLabel?: string;
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
  onNewModelSession,
  onOpenRepository,
  onOpenSettings,
  onOpenHistory,
  onOpenProviders,
  onOpenActivity,
  onOpenCode,
  header,
  footer,
  connectedLabel,
  className,
}: ProjectSidebarProps) {
  const [filter, setFilter] = useState("");
  const conn = connection.status === "connected" && connectedLabel ? { ...CONNECTION_LABEL.connected, label: connectedLabel } : CONNECTION_LABEL[connection.status];
  const projectSessions = activeProjectId ? sessions.filter((s) => s.projectId === activeProjectId) : sessions;

  return (
    <aside aria-label="Projects and conversations" className={cn("flex h-full min-h-0 flex-col bg-surface-2/60", className)}>
      {header}
      <div className="space-y-1 px-2.5 pb-2 pt-1">
        <button
          type="button"
          onClick={onNewSession}
          disabled={!onNewSession || !activeProjectId}
          className="group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-3 focus-ring disabled:opacity-50"
        >
          <SquarePen className="size-4" />
          <span className="flex-1 text-left">New chat</span>
          <Kbd keys="mod+n" className="opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        {onNewModelSession ? (
          <button type="button" onClick={onNewModelSession} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-3 focus-ring">
            <MessageSquareText className="size-4" />
            <span className="flex-1 text-left">New model chat</span>
          </button>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 w-full rounded-lg border border-transparent bg-transparent pl-8 pr-2 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:bg-surface-3 focus-visible:border-border focus-visible:bg-surface focus-visible:outline-none"
          />
        </div>
      </div>
      <div className="px-2.5 pb-2">
        <div className="px-2.5 pb-1 text-2xs font-medium text-fg-subtle">Project</div>
        <ProjectSwitcher projects={projects} activeProjectId={activeProjectId} onSelect={onSelectProject} onOpenRepository={onOpenRepository} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {sessionsUnavailable ? (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">{sessionsUnavailable}</p>
        ) : loading ? (
          <SessionListSkeleton />
        ) : (
          <SessionList sessions={projectSessions} projects={projects} activeSessionId={activeSessionId} onSelect={onSelectSession} grouping="date" filter={filter} />
        )}
      </div>
      <footer className="space-y-0.5 border-t border-border p-2.5">
        {onOpenCode ? (
          <button type="button" onClick={onOpenCode} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-ring">
            <Code2 className="size-4" /> <span className="flex-1 text-left">Code</span>
            <Kbd keys="mod+e" className="opacity-70" />
          </button>
        ) : null}
        {onOpenActivity ? (
          <button type="button" onClick={onOpenActivity} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-ring">
            <Activity className="size-4" /> GitHub &amp; Vercel
          </button>
        ) : null}
        {onOpenProviders ? (
          <button
            type="button"
            onClick={onOpenProviders}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-ring"
            aria-label="Providers"
          >
            <KeyRound className="size-4" />
            <span className="flex-1 text-left">Providers</span>
            <span className="flex items-center gap-1">
              {providers?.map((p) => (
                <Tooltip key={p.agentId} content={`${AGENT_DISPLAY[p.agentId].name}: ${p.status === "ready" ? "ready" : p.status.replace("_", " ")}`} side="top">
                  <span className={cn("size-1.5 rounded-full", PROVIDER_DOT[p.status])} />
                </Tooltip>
              ))}
            </span>
          </button>
        ) : null}
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 text-xs text-fg-muted" role="status" title={connection.detail}>
            <span className={cn("size-1.5 shrink-0 rounded-full", conn.dot)} />
            <span className="truncate">{conn.label}</span>
          </div>
          {onOpenHistory ? (
            <Tooltip content="All chats" shortcut="mod+y" side="top">
              <Button variant="ghost" size="icon" aria-label="All chats" onClick={onOpenHistory}>
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
        {footer}
      </footer>
    </aside>
  );
}

/** Small row of provider marks with status dots, e.g. for headers. */
export function ProviderDots({ providers }: { providers: ProviderConfig[] }) {
  return (
    <span className="flex items-center gap-1.5">
      {providers.map((p) => (
        <span key={p.agentId} className="relative">
          <AgentMark agentId={p.agentId} size="sm" />
          <span className={cn("absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-surface", PROVIDER_DOT[p.status])} />
        </span>
      ))}
    </span>
  );
}
