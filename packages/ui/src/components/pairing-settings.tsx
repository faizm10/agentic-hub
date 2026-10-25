"use client";

import { Globe, Link2Off, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PairingInfo } from "../model/types";
import { formatRelative } from "../lib/format";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Input, Switch } from "../primitives/form";

export interface PairingSettingsProps {
  pairing?: PairingInfo;
  loading?: boolean;
  error?: string;
  /** Pre-fills the web app address. */
  defaultUrl?: string;
  onPair: (input: { controlPlaneUrl: string; code: string; deviceName?: string }) => Promise<unknown>;
  onToggleRemoteControl: (allow: boolean) => Promise<unknown>;
  onUnpair: () => Promise<unknown>;
}

/**
 * Connects this computer's runtime to the Agentic Hub web app. The runtime
 * only makes outbound HTTPS requests; nothing on this computer is exposed to
 * the internet. Remote control stays off until the user turns it on here.
 */
export function PairingSettings({ pairing, loading, error, defaultUrl = "", onPair, onToggleRemoteControl, onUnpair }: PairingSettingsProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="skeleton h-28 rounded-xl" />;
  if (error) return <p className="text-sm text-fg-muted">{error}</p>;

  if (pairing?.paired) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Globe className="size-4 text-fg-subtle" />
          <span className="font-medium text-fg">{pairing.deviceName}</span>
          <span className="text-fg-subtle">paired with</span>
          <a href={pairing.controlPlaneUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {pairing.controlPlaneUrl}
          </a>
          {pairing.lastError ? <Badge tone="warning">Sync issue</Badge> : <Badge tone="success">Syncing</Badge>}
        </div>
        <p className="text-xs text-fg-subtle">
          {pairing.lastError ?? (pairing.lastSyncAt ? `Last synced ${formatRelative(pairing.lastSyncAt)}.` : "Waiting for the first sync…")}
        </p>
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
              <ShieldCheck className="size-4" /> Allow control from the web
            </span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              Lets your signed-in web account start chats, send messages, stop runs and answer approvals on this computer. Off by default.
            </span>
          </span>
          <Switch checked={pairing.allowRemoteControl} disabled={busy} onCheckedChange={(v) => void run(() => onToggleRemoteControl(v))} aria-label="Allow control from the web" />
        </label>
        <Button size="sm" variant="danger-soft" disabled={busy} onClick={() => void run(onUnpair)}>
          <Link2Off /> Disconnect from the web app
        </Button>
        {actionError ? <p role="alert" className="text-xs text-danger">{actionError}</p> : null}
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => onPair({ controlPlaneUrl: url.trim(), code: code.trim(), deviceName: name.trim() || undefined }));
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {pairing?.lastError ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-fg">{pairing.lastError}</p> : null}
      <ol className="list-decimal space-y-1 pl-5 text-xs text-fg-muted">
        <li>Sign in to the Agentic Hub web app and open <span className="font-medium text-fg">Devices</span>.</li>
        <li>Choose <span className="font-medium text-fg">Pair a device</span> and copy the code.</li>
        <li>Enter the web address and code here.</li>
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Web app address" placeholder="https://your-app.vercel.app" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} inputMode="url" />
        <Input aria-label="Pairing code" placeholder="ABCD-2345" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={busy} className="font-mono tracking-widest" autoComplete="off" />
        <Input aria-label="Device name (optional)" placeholder="Device name (optional)" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="sm:col-span-2" />
      </div>
      <Button type="submit" size="sm" variant="primary" disabled={busy || !url.trim() || code.trim().length < 6}>
        {busy ? "Pairing…" : "Pair this computer"}
      </Button>
      {actionError ? <p role="alert" className="text-xs text-danger">{actionError}</p> : null}
      <p className="text-xs text-fg-subtle">
        This computer connects out to the web app over HTTPS. Your runtime is never exposed to the internet, and your provider keys and CLI sign-ins stay here.
      </p>
    </form>
  );
}
