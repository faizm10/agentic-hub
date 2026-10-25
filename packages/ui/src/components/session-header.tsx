"use client";

import { GitBranch, Square } from "lucide-react";
import type { ReactNode } from "react";
import { AGENT_DISPLAY } from "../model/agents";
import { isRunActive } from "../model/events";
import type { Project, SessionSummary } from "../model/types";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Tooltip } from "../primitives/tooltip";
import { AgentMark } from "./agent-mark";
import { RunStatusIndicator } from "./run-status-indicator";

export function SessionHeader({
  session,
  project,
  onCancel,
  cancelUnavailableReason,
  actions,
  leading,
  className,
}: {
  /** Rendered before the title, e.g. panel toggles. */
  leading?: ReactNode;
  session?: SessionSummary;
  project?: Project;
  onCancel?: () => void;
  cancelUnavailableReason?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const active = session ? isRunActive(session.status) : false;
  return (
    <header data-tauri-drag-region className={cn("flex h-11 shrink-0 items-center gap-3 border-b border-border", leading ? "pl-2 pr-3" : "px-4", className)}>
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {session ? <AgentMark agentId={session.agentId} /> : null}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-medium text-fg">{session?.title ?? "New session"}</h1>
          {project ? (
            <span className="hidden min-w-0 items-center gap-1 truncate text-xs text-fg-subtle md:inline-flex">
              <span className="truncate">{project.name}</span>
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate font-mono text-2xs">{session?.branch ?? project.branch}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {session ? (
          <>
            <span className="hidden text-xs text-fg-subtle lg:inline">
              {AGENT_DISPLAY[session.agentId].name}
              {session.model ? ` · ${session.model}` : ""}
            </span>
            <RunStatusIndicator status={session.status} />
          </>
        ) : null}
        {active ? (
          <Tooltip content={cancelUnavailableReason ?? "Cancel run"} shortcut={cancelUnavailableReason ? undefined : "mod+."}>
            <span>
              <Button
                size="sm"
                variant="danger-soft"
                onClick={onCancel}
                disabled={!onCancel || Boolean(cancelUnavailableReason) || session?.status === "cancelling"}
              >
                <Square className="fill-current !size-2.5" />
                {session?.status === "cancelling" ? "Cancelling…" : "Stop"}
              </Button>
            </span>
          </Tooltip>
        ) : null}
        {actions}
      </div>
    </header>
  );
}