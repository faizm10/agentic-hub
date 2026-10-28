"use client";

import { Check } from "lucide-react";
import { cn } from "../lib/cn";
import type { AgentDescriptor, AgentId, ProviderConfig } from "../model/types";
import { AgentMark } from "./agent-mark";

/** Pick several ready agents to run one prompt in parallel. Unready agents are shown but disabled. */
export function MultiAgentPicker({
  agents,
  providers,
  value,
  onChange,
  className,
}: {
  agents: AgentDescriptor[];
  providers?: ProviderConfig[];
  value: AgentId[];
  onChange: (agents: AgentId[]) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Agents to run" className={cn("flex flex-wrap items-center gap-1", className)}>
      {agents.map((agent) => {
        const ready = providers?.find((p) => p.agentId === agent.id)?.status === "ready";
        const on = value.includes(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            disabled={!ready}
            aria-pressed={on}
            title={ready ? undefined : `${agent.name} isn't ready`}
            onClick={() => onChange(on ? value.filter((id) => id !== agent.id) : [...value, agent.id])}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs transition-colors focus-ring disabled:opacity-40",
              on ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            <AgentMark agentId={agent.id} size="sm" />
            {agent.name}
            {on ? <Check className="size-3 text-accent" /> : null}
          </button>
        );
      })}
    </div>
  );
}
