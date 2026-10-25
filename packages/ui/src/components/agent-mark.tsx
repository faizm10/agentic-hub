"use client";

import { AGENT_DISPLAY } from "../model/agents";
import type { AgentId } from "../model/types";
import { cn } from "../lib/cn";

/** Compact agent glyph. Colour comes from the per-agent token. */
export function AgentMark({ agentId, size = "md", className }: { agentId: AgentId; size?: "sm" | "md" | "lg"; className?: string }) {
  const display = AGENT_DISPLAY[agentId];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold tracking-tight",
        size === "sm" && "size-4 text-[8.5px]",
        size === "md" && "size-5 text-[10px]",
        size === "lg" && "size-8 rounded-lg text-sm",
        className,
      )}
      style={{
        color: display.colorVar,
        background: `color-mix(in oklch, ${display.colorVar} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${display.colorVar} 28%, transparent)`,
      }}
    >
      {display.short}
    </span>
  );
}

export function AgentLabel({ agentId, className }: { agentId: AgentId; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <AgentMark agentId={agentId} size="sm" />
      <span>{AGENT_DISPLAY[agentId].name}</span>
    </span>
  );
}