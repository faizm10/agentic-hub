"use client";

import { ChevronDown } from "lucide-react";
import { AGENT_DISPLAY } from "../model/agents";
import type { AgentDescriptor, AgentId, ProviderConfig } from "../model/types";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../primitives/menu";
import { Kbd } from "../primitives/kbd";
import { AgentMark } from "./agent-mark";

const PROVIDER_NOTE: Partial<Record<ProviderConfig["status"], string>> = {
  needs_auth: "Sign-in required",
  not_installed: "Not installed",
  error: "Unavailable",
};

export function AgentSelector({
  agents,
  providers,
  value,
  onChange,
  disabled,
  className,
}: {
  agents: AgentDescriptor[];
  providers?: ProviderConfig[];
  value: AgentId;
  onChange: (agentId: AgentId) => void;
  disabled?: boolean;
  className?: string;
}) {
  const providerFor = (id: AgentId) => providers?.find((p) => p.agentId === id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Agent: ${AGENT_DISPLAY[value].name}. Change agent`}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-3 focus-ring disabled:opacity-50 data-[state=open]:bg-surface-3",
          className,
        )}
      >
        <AgentMark agentId={value} size="sm" />
        {AGENT_DISPLAY[value].name}
        <ChevronDown className="size-3 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as AgentId)}>
          {agents.map((agent, index) => {
            const provider = providerFor(agent.id);
            const note = provider ? PROVIDER_NOTE[provider.status] : undefined;
            return (
              <DropdownMenuRadioItem key={agent.id} value={agent.id} className="h-auto items-start py-2">
                <AgentMark agentId={agent.id} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">{agent.name}</span>
                    {note ? <span className="text-2xs text-warning">{note}</span> : null}
                  </div>
                  <p className="text-xs leading-snug text-fg-subtle">{agent.description}</p>
                </div>
                <Kbd keys={`mod+${index + 1}`} className="mt-0.5" />
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}