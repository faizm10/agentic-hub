"use client";

import { ArrowUp, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { validateAssignments, type AgentAssignment } from "../lib/multi-agent";
import { AGENT_DISPLAY } from "../model/agents";
import type { AgentDescriptor, AgentId, ProviderConfig } from "../model/types";
import { Button } from "../primitives/button";
import { AgentMark } from "./agent-mark";

export interface MultiAgentComposerProps {
  agents: AgentDescriptor[];
  providers?: ProviderConfig[];
  assignments: AgentAssignment[];
  onAssignmentsChange: (assignments: AgentAssignment[]) => void;
  goal: string;
  onGoalChange: (goal: string) => void;
  onSubmit: () => Promise<unknown>;
  /** Mode switch, worktree toggle, etc. */
  toolbar?: ReactNode;
  footer?: ReactNode;
  disabledReason?: string;
  className?: string;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

/**
 * Multi-agent composer: an optional shared goal, then one row per agent with
 * its own task. The same agent can appear more than once.
 */
export function MultiAgentComposer({ agents, providers, assignments, onAssignmentsChange, goal, onGoalChange, onSubmit, toolbar, footer, disabledReason, className }: MultiAgentComposerProps) {
  const [submitting, setSubmitting] = useState(false);
  const ready = agents.filter((a) => providers?.find((p) => p.agentId === a.id)?.status === "ready");
  const problem = disabledReason ?? (ready.length ? validateAssignments(assignments) : "No agents are ready yet.");
  const update = (id: string, patch: Partial<AgentAssignment>) => onAssignmentsChange(assignments.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const add = () => {
    const used = new Set(assignments.map((a) => a.agentId));
    const next: AgentId | undefined = ready.find((a) => !used.has(a.id))?.id ?? ready[0]?.id;
    if (next) onAssignmentsChange([...assignments, { id: newId(), agentId: next, task: "" }]);
  };
  const submit = async () => {
    if (problem || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit();
    } catch {
      // The caller shows the error; the tasks stay so nothing is lost.
    } finally {
      setSubmitting(false);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className={cn("mx-auto w-full max-w-[48rem] px-3 pb-3 sm:px-6 sm:pb-4", className)}>
      <div className="rounded-[1.6rem] border border-border bg-surface p-3 shadow-md focus-within:border-border-strong">
        <label className="block px-1">
          <span className="sr-only">Shared goal</span>
          <textarea
            value={goal}
            onChange={(e) => onGoalChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(3, Math.max(1, Math.ceil(goal.length / 90)))}
            placeholder="Shared goal (optional), e.g. “Add user settings”"
            className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
        <ol className="mt-2 space-y-1.5" aria-label="Agent tasks">
          {assignments.map((a, i) => (
            <li key={a.id} className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-1.5">
              <span className="mt-1.5 flex shrink-0 items-center gap-1.5">
                <AgentMark agentId={a.agentId} size="sm" />
                <select
                  value={a.agentId}
                  onChange={(e) => update(a.id, { agentId: e.target.value as AgentId })}
                  aria-label={`Agent ${i + 1}`}
                  className="h-6 max-w-[8.5rem] rounded-md border border-border bg-surface px-1 text-xs text-fg focus-ring"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id} disabled={!ready.some((r) => r.id === agent.id)}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </span>
              <textarea
                value={a.task}
                onChange={(e) => update(a.id, { task: e.target.value })}
                onKeyDown={onKeyDown}
                // Grow with the text (up to four lines) so long tasks stay readable.
                rows={Math.min(4, Math.max(1, Math.ceil(a.task.length / 72), a.task.split("\n").length))}
                aria-label={`Task for ${AGENT_DISPLAY[a.agentId].name}`}
                placeholder={i === 0 ? "This agent's task, e.g. “Build the settings page”" : i === 1 ? "A different task, e.g. “Write tests for the settings API”" : "Another part of the work"}
                className="min-h-7 flex-1 resize-y bg-transparent py-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${AGENT_DISPLAY[a.agentId].name}`} disabled={assignments.length <= 2} onClick={() => onAssignmentsChange(assignments.filter((x) => x.id !== a.id))}>
                <X />
              </Button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="ghost" onClick={add} disabled={!ready.length || assignments.length >= 6}>
            <Plus /> Add agent
          </Button>
          {toolbar}
          <span className="flex-1" />
          <Button size="icon" variant="primary" className="rounded-full" aria-label="Start agents" disabled={Boolean(problem) || submitting} onClick={() => void submit()}>
            <ArrowUp />
          </Button>
        </div>
      </div>
      <div className="mt-1.5 flex min-h-4 items-center justify-between gap-2 px-2 text-2xs text-fg-subtle">
        <span className={cn(problem && assignments.some((a) => a.task.trim()) && "text-warning")}>{problem && assignments.some((a) => a.task.trim()) ? problem : footer}</span>
        <span className="shrink-0">⌘↵ to start</span>
      </div>
    </div>
  );
}

export function initialAssignments(agentIds: AgentId[]): AgentAssignment[] {
  const ids = agentIds.length >= 2 ? agentIds.slice(0, 6) : [...agentIds, ...agentIds].slice(0, 2);
  // Deterministic ids, so rows keep focus across re-renders before the first edit.
  return ids.map((agentId, i) => ({ id: `row-${i}`, agentId, task: "" }));
}
