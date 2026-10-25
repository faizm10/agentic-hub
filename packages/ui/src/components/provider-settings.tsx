"use client";

import { ExternalLink, KeyRound, LockKeyhole, RefreshCw, Terminal } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { AgentDescriptor, ProviderConfig, ProviderStatus } from "../model/types";
import { cn } from "../lib/cn";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Input } from "../primitives/form";
import { AgentMark } from "./agent-mark";

const STATUS: Record<ProviderStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ready: { label: "Connected", tone: "success" },
  needs_auth: { label: "Needs setup", tone: "warning" },
  not_installed: { label: "Not installed", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
  unknown: { label: "Checking…", tone: "neutral" },
};

/** How to get each CLI agent ready. Commands are the providers' documented ones. */
const CLI_SETUP: Record<string, { install: string; signIn: string }> = {
  codex: { install: "npm install -g @openai/codex", signIn: "codex login" },
  "claude-code": { install: "curl -fsSL https://claude.ai/install.sh | bash", signIn: "claude" },
  muse: { install: "curl -fsSL https://dev.meta.ai/install.sh | sh", signIn: "muse" },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr] sm:items-start sm:gap-4">
      <div className="pt-1 text-sm text-fg-muted">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Command({ children }: { children: string }) {
  return <code className="block overflow-x-auto whitespace-nowrap rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-fg" data-selectable>{children}</code>;
}

export interface ApiKeyHandlers {
  onSave: (apiKey: string) => Promise<unknown>;
  onClear: () => Promise<unknown>;
}

function ApiKeyForm({ agent, provider, handlers, readOnly }: { agent: AgentDescriptor; provider: ProviderConfig; handlers?: ApiKeyHandlers; readOnly: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fromEnv = provider.credential?.source === "environment";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!handlers || !value.trim()) return;
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      await handlers.onSave(value.trim());
      setValue("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The key could not be saved.");
    } finally {
      setBusy(null);
    }
  };
  const clear = async () => {
    if (!handlers) return;
    setBusy("clear");
    setError(null);
    setSaved(false);
    try {
      await handlers.onClear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The key could not be removed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {provider.credential ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <KeyRound className="size-3.5 text-fg-subtle" />
          <code className="font-mono text-xs text-fg">{provider.credential.hint}</code>
          <span className="text-xs text-fg-subtle">{fromEnv ? "from the runtime’s environment" : "stored encrypted on this device"}</span>
          {!fromEnv && handlers && !readOnly ? (
            <Button size="xs" variant="ghost" onClick={() => void clear()} disabled={busy !== null}>
              {busy === "clear" ? "Removing…" : "Remove"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          name={`${agent.id}-api-key`}
          aria-label={`${agent.name} API key`}
          placeholder={provider.credential ? "Replace with a new key" : `Paste your ${agent.name} API key`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={readOnly || !handlers || busy !== null}
          className="h-9 flex-1 font-mono text-xs"
        />
        <Button type="submit" variant="primary" className="h-9" disabled={readOnly || !handlers || busy !== null || value.trim().length < 8}>
          {busy === "save" ? "Verifying…" : provider.credential ? "Replace key" : "Save key"}
        </Button>
      </form>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {saved ? <p role="status" className="text-xs text-success">Key verified with {agent.name} and saved.</p> : null}
      <p className="text-xs text-fg-subtle">
        The key goes to the local runtime once, is checked with {agent.name}, and is stored encrypted. It is never shown again or sent anywhere else.
        A ChatGPT or Claude subscription does not include API access; API usage is billed separately by the provider.
      </p>
    </div>
  );
}

export function ProviderCard({
  agent,
  provider,
  readOnlyReason,
  apiKey,
  onRecheck,
  rechecking,
  models,
}: {
  agent: AgentDescriptor;
  provider: ProviderConfig;
  /** Disables controls and explains why (e.g. runtime offline, demo mode). */
  readOnlyReason?: string;
  apiKey?: ApiKeyHandlers;
  onRecheck?: () => void;
  rechecking?: boolean;
  /** Rendered under the status, e.g. the discovered model list. */
  models?: ReactNode;
}) {
  const status = STATUS[provider.status];
  const setup = CLI_SETUP[agent.id];
  const readOnly = Boolean(readOnlyReason);
  return (
    <section aria-labelledby={`provider-${agent.id}`} className="rounded-2xl border border-border bg-surface">
      <header className="flex items-start gap-3 p-4 pb-3">
        <AgentMark agentId={agent.id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`provider-${agent.id}`} className="text-base font-semibold text-fg">
              {agent.name}
            </h3>
            <Badge tone={status.tone} size="md">
              {status.label}
            </Badge>
            {provider.version ? <span className="font-mono text-2xs text-fg-subtle">{provider.version}</span> : null}
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{agent.description}</p>
        </div>
        {onRecheck ? (
          <Button size="sm" variant="ghost" onClick={onRecheck} disabled={readOnly || rechecking}>
            <RefreshCw className={cn(rechecking && "animate-spin")} /> {rechecking ? "Checking…" : "Re-check"}
          </Button>
        ) : null}
      </header>
      <div className="space-y-4 border-t border-border p-4">
        {provider.detail && provider.status !== "ready" ? (
          <p className={cn("rounded-lg px-3 py-2 text-sm", provider.status === "error" ? "bg-danger-soft text-fg" : "bg-warning-soft text-fg")}>{provider.detail}</p>
        ) : null}
        {provider.authMethod === "api-key" ? (
          <Row label="API key">
            <ApiKeyForm agent={agent} provider={provider} handlers={apiKey} readOnly={readOnly} />
          </Row>
        ) : (
          <Row label="Sign-in">
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                <Terminal className="size-3.5" /> Uses the {agent.name} CLI&rsquo;s own sign-in on the computer that runs it. Agentic Hub never sees your password or tokens.
              </p>
              {setup && provider.status === "not_installed" ? (
                <div className="space-y-1">
                  <div className="text-xs text-fg-subtle">Install</div>
                  <Command>{setup.install}</Command>
                </div>
              ) : null}
              {setup && provider.status !== "ready" ? (
                <div className="space-y-1">
                  <div className="text-xs text-fg-subtle">Then sign in in a terminal, and press Re-check</div>
                  <Command>{setup.signIn}</Command>
                </div>
              ) : null}
            </div>
          </Row>
        )}
        {models ? <Row label="Models">{models}</Row> : null}
        {provider.setupUrl ? (
          <a
            href={provider.setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            {provider.authMethod === "api-key" ? `Get an ${agent.name} API key` : `${agent.name} setup guide`} <ExternalLink className="size-3" />
          </a>
        ) : null}
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
  apiKey,
  onRecheck,
  rechecking,
  renderModels,
}: {
  agents: AgentDescriptor[];
  providers: ProviderConfig[];
  readOnlyReason?: string;
  apiKey?: (agentId: ProviderConfig["agentId"]) => ApiKeyHandlers;
  onRecheck?: () => void;
  rechecking?: boolean;
  renderModels?: (agent: AgentDescriptor, provider: ProviderConfig) => ReactNode;
}) {
  const section = (title: string, description: string, kind: AgentDescriptor["kind"]) => {
    const list = agents.filter((a) => a.kind === kind);
    if (!list.length) return null;
    return (
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
        {list.map((agent) => {
          const provider = providers.find((p) => p.agentId === agent.id);
          if (!provider) return null;
          return (
            <ProviderCard
              key={agent.id}
              agent={agent}
              provider={provider}
              readOnlyReason={readOnlyReason}
              apiKey={apiKey?.(agent.id)}
              onRecheck={onRecheck}
              rechecking={rechecking}
              models={renderModels?.(agent, provider)}
            />
          );
        })}
      </div>
    );
  };
  return (
    <div className="space-y-8">
      {section("Coding agents", "Work inside your repository: read and edit files and run commands, asking you before anything risky.", "agent")}
      {section("Model APIs", "Conversational models through the official APIs. They answer in chat and never touch your files.", "model")}
    </div>
  );
}
