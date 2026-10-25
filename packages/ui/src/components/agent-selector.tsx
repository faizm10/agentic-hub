"use client";

import { Check, ChevronDown } from "lucide-react";
import { AGENT_DISPLAY, AGENT_ORDER } from "../model/agents";
import type { AgentDescriptor, AgentId, ModelOption, ProviderConfig } from "../model/types";
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
import { AgentMark } from "./agent-mark";

const PROVIDER_NOTE: Partial<Record<ProviderConfig["status"], string>> = {
  needs_auth: "Needs setup",
  not_installed: "Not installed",
  error: "Unavailable",
  unknown: "Checking…",
};

const triggerClass =
  "inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-3 focus-ring disabled:opacity-50 data-[state=open]:bg-surface-3";

export function AgentSelector({
  agents,
  providers,
  value,
  onChange,
  onManageProviders,
  disabled,
  className,
}: {
  agents: AgentDescriptor[];
  providers?: ProviderConfig[];
  value: AgentId;
  onChange: (agentId: AgentId) => void;
  /** Adds a "Manage providers" entry. */
  onManageProviders?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const providerFor = (id: AgentId) => providers?.find((p) => p.agentId === id);
  const ordered = AGENT_ORDER.map((id) => agents.find((a) => a.id === id)).filter((a): a is AgentDescriptor => Boolean(a));
  const groups = [
    { label: "Coding agents · work in your repository", items: ordered.filter((a) => a.kind === "agent") },
    { label: "Models · chat only", items: ordered.filter((a) => a.kind === "model") },
  ].filter((g) => g.items.length);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} aria-label={`Agent: ${AGENT_DISPLAY[value].name}. Change agent`} className={cn(triggerClass, className)}>
        <AgentMark agentId={value} size="sm" />
        <span className="truncate">{AGENT_DISPLAY[value].name}</span>
        <ChevronDown className="size-3 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as AgentId)}>
          {groups.map((group, g) => (
            <div key={group.label}>
              {g > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.items.map((agent) => {
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
                    <Kbd keys={`mod+${AGENT_ORDER.indexOf(agent.id) + 1}`} className="mt-0.5" />
                  </DropdownMenuRadioItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuRadioGroup>
        {onManageProviders ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManageProviders}>Manage providers…</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Model picker for one provider. Models come from the provider's own
 * discovery; while they load or when discovery fails, the provider default
 * is used and the reason is shown.
 */
export function ModelSelector({
  models,
  value,
  onChange,
  loading,
  error,
  defaultLabel = "Default model",
  disabled,
  className,
}: {
  models?: ModelOption[];
  value?: string;
  onChange: (modelId: string | undefined) => void;
  loading?: boolean;
  error?: string;
  defaultLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = models?.find((m) => m.id === value);
  const label = selected?.name ?? (value || defaultLabel);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} aria-label={`Model: ${label}. Change model`} className={cn(triggerClass, "font-normal text-fg-muted", className)}>
        <span className="truncate">{loading ? "Loading models…" : label}</span>
        <ChevronDown className="size-3 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(60vh,28rem)] w-80 overflow-y-auto">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(undefined)} className="h-auto py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-fg">{defaultLabel}</div>
            <div className="text-xs text-fg-subtle">Use the provider&rsquo;s default</div>
          </div>
          {!value ? <Check className="size-3.5 text-fg" /> : null}
        </DropdownMenuItem>
        {error ? <p className="px-2 py-2 text-xs text-fg-subtle">{error}</p> : null}
        {models?.map((model) => (
          <DropdownMenuItem key={model.id} onSelect={() => onChange(model.id)} className="h-auto py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-fg">
                <span className="truncate">{model.name}</span>
                {model.isDefault ? <span className="text-2xs text-fg-subtle">default</span> : null}
              </div>
              {model.description ? <div className="line-clamp-2 text-xs text-fg-subtle">{model.description}</div> : null}
            </div>
            {value === model.id ? <Check className="size-3.5 text-fg" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
