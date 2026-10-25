"use client";

import { KeyRound, LockKeyhole, RefreshCw } from "lucide-react";
import type { AgentDescriptor, ProviderConfig, ProviderStatus } from "../model/types";
import { cn } from "../lib/cn";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { SegmentedControl } from "../primitives/form";
import { AgentMark } from "./agent-mark";

const STATUS: Record<ProviderStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ready: { label: "Ready", tone: "success" },
  needs_auth: { label: "Sign-in required", tone: "warning" },
  not_installed: { label: "Not installed", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};

const POLICY_OPTIONS: { value: ProviderConfig["approvalPolicy"]; label: string }[] = [
  { value: "always", label: "Always ask" },
  { value: "untrusted", label: "Untrusted only" },
  { value: "never", label: "Never ask" },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_1fr] sm:items-center sm:gap-4">
      <div>
        <div className="text-sm text-fg">{label}</div>
        {hint ? <div className="text-2xs text-fg-subtle">{hint}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ProviderCard({
  agent,
  provider,
  readOnlyReason,
  onChange,
  onRecheck,
}: {
  agent: AgentDescriptor;
  provider: ProviderConfig;
  /** Disables controls and explains why (e.g. runtime offline, demo mode). */
  readOnlyReason?: string;
  onChange?: (patch: Partial<Pick<ProviderConfig, "defaultModel" | "approvalPolicy">>) => void;
  onRecheck?: () => void;
}) {
  const status = STATUS[provider.status];
  const editable = !readOnlyReason && Boolean(onChange);
  return (
    <section aria-labelledby={`provider-${agent.id}`} className="rounded-xl border border-border bg-surface">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <AgentMark agentId={agent.id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`provider-${agent.id}`} className="text-base font-medium text-fg">
              {agent.name}
            </h3>
            <Badge tone={status.tone} size="md">
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{agent.description}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRecheck} disabled={!onRecheck || Boolean(readOnlyReason)}>
          <RefreshCw /> Re-check
        </Button>
      </header>
      <div className="space-y-4 p-4">
        {provider.detail ? (
          <p className={cn("rounded-md px-3 py-2 text-xs", provider.status === "ready" ? "bg-surface-2 text-fg-muted" : "bg-warning-soft text-fg")}>{provider.detail}</p>
        ) : null}
        <Field label="Authentication" hint="Handled by the runtime">
          <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <KeyRound className="size-3.5" />
            {provider.authMethod === "cli-login" ? "CLI login on this device" : provider.authMethod === "api-key" ? "API key in runtime keychain" : "None"}
          </span>
        </Field>
        <Field label="Executable">
          <code className="block truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-fg-muted">{provider.executablePath ?? "Not detected"}</code>
        </Field>
        {provider.version ? (
          <Field label="Version">
            <span className="font-mono text-xs text-fg-muted">{provider.version}</span>
          </Field>
        ) : null}
        <Field label="Default model">
          <select
            aria-label={`${agent.name} default model`}
            disabled={!editable || provider.availableModels.length === 0}
            value={provider.defaultModel ?? ""}
            onChange={(e) => onChange?.({ defaultModel: e.target.value })}
            className="h-8 w-full max-w-xs rounded-md border border-border bg-surface px-2 text-sm text-fg focus-ring disabled:opacity-60"
          >
            {provider.availableModels.length === 0 ? <option value="">No models available</option> : null}
            {provider.availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tool approvals" hint="When to ask before running tools">
          <div className={cn(!editable && "pointer-events-none opacity-60")} aria-disabled={!editable}>
            <SegmentedControl
              label={`${agent.name} approval policy`}
              value={provider.approvalPolicy}
              onChange={(v) => onChange?.({ approvalPolicy: v })}
              options={POLICY_OPTIONS}
            />
          </div>
        </Field>
        {readOnlyReason ? (
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <LockKeyhole className="size-3" /> {readOnlyReason}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function ProviderSettings({
  agents,
  providers,
  readOnlyReason,
  onChange,
  onRecheck,
}: {
  agents: AgentDescriptor[];
  providers: ProviderConfig[];
  readOnlyReason?: string;
  onChange?: (agentId: ProviderConfig["agentId"], patch: Partial<Pick<ProviderConfig, "defaultModel" | "approvalPolicy">>) => void;
  onRecheck?: (agentId: ProviderConfig["agentId"]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 text-xs text-fg-muted">
        <LockKeyhole className="mt-px size-3.5 shrink-0" />
        Agentic Hub never stores provider credentials in the app. Each agent authenticates through its own CLI or the
        local runtime&rsquo;s keychain.
      </p>
      {agents.map((agent) => {
        const provider = providers.find((p) => p.agentId === agent.id);
        if (!provider) return null;
        return (
          <ProviderCard
            key={agent.id}
            agent={agent}
            provider={provider}
            readOnlyReason={readOnlyReason}
            onChange={onChange ? (patch) => onChange(agent.id, patch) : undefined}
            onRecheck={onRecheck ? () => onRecheck(agent.id) : undefined}
          />
        );
      })}
    </div>
  );
}