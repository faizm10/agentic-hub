"use client";

import { ChevronsUpDown, FolderGit2, FolderOpen, MessageSquareText } from "lucide-react";
import type { Project } from "../model/types";
import { isModelChatProjectId } from "../model/agents";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../primitives/menu";
import { Kbd } from "../primitives/kbd";

export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelect,
  onOpenRepository,
  openRepositoryLabel = "Open repository…",
  className,
}: {
  projects: Project[];
  activeProjectId?: string;
  onSelect: (projectId: string) => void;
  onOpenRepository?: () => void;
  openRepositoryLabel?: string;
  className?: string;
}) {
  const active = projects.find((p) => p.id === activeProjectId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-surface-3 focus-ring data-[state=open]:bg-surface-3",
          className,
        )}
        aria-label="Switch project"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-muted">
          {active && isModelChatProjectId(active.id) ? <MessageSquareText className="size-3.5" /> : <FolderGit2 className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{active?.name ?? "Select a project"}</span>
          {active ? <span className="block truncate font-mono text-2xs text-fg-subtle">{isModelChatProjectId(active.id) ? "OpenAI and Claude" : active.branch}</span> : null}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeProjectId} onValueChange={onSelect}>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id} className="h-auto py-1.5">
              <div className="min-w-0">
                <div className="truncate text-sm text-fg">{project.name}</div>
                <div className="truncate font-mono text-2xs text-fg-subtle">{isModelChatProjectId(project.id) ? "OpenAI and Claude" : project.path}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onOpenRepository ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenRepository}>
              <FolderOpen />
              <span className="flex-1">{openRepositoryLabel}</span>
              <Kbd keys="mod+o" />
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
