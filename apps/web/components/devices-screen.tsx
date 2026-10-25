"use client";

import { Badge, Button, EmptyState, ErrorState, Skeleton, formatRelative } from "@agentic-hub/ui";
import { errorMessage } from "@agentic-hub/ui/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Laptop, Link2, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WebClient } from "@/lib/web-client";

function PairingCode({ client }: { client: WebClient }) {
  const [copied, setCopied] = useState(false);
  const code = useMutation({ mutationFn: () => client.createPairingCode() });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
        <Link2 className="size-4" /> Pair a computer
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        In the Agentic Hub desktop app, open <span className="font-medium text-fg">Settings → Web access</span>, enter this site&rsquo;s address and the code below. The code works once and expires in 10 minutes.
      </p>
      {code.data ? (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-xl bg-surface-3 px-4 py-2 font-mono text-2xl tracking-[0.2em] text-fg" data-selectable>
              {code.data.code}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(code.data.code).then(() => setCopied(true));
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            Web address: <code className="font-mono text-fg">{origin}</code> · expires {formatRelative(code.data.expiresAt)}
          </p>
        </div>
      ) : null}
      {code.isError ? <p className="mt-3 text-sm text-danger">{errorMessage(code.error)}</p> : null}
      <Button variant="primary" size="sm" className="mt-4" disabled={code.isPending} onClick={() => { setCopied(false); code.mutate(); }}>
        {code.data ? "Create a new code" : code.isPending ? "Creating…" : "Create pairing code"}
      </Button>
    </section>
  );
}

export function DevicesScreen({ client }: { client: WebClient }) {
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ["device-views"], queryFn: () => client.listDeviceViews(), refetchInterval: 5_000 });
  const remove = useMutation({
    mutationFn: (id: string) => client.removeDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  return (
    <div className="space-y-6">
      <PairingCode client={client} />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg">Your computers</h2>
        {devices.isPending ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : devices.isError ? (
          <ErrorState compact message={errorMessage(devices.error)} onRetry={() => void devices.refetch()} />
        ) : !devices.data.length ? (
          <EmptyState compact icon={<Laptop />} title="No computers paired yet" description="Pair the desktop app to follow and control coding agents from the web." />
        ) : (
          devices.data.map((device) => {
            const ready = device.snapshot?.providers.filter((p) => p.ready) ?? [];
            return (
              <article key={device.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-surface-3 text-fg">
                    <Laptop className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-fg">{device.name}</h3>
                      <Badge tone={device.online ? "success" : "neutral"}>{device.online ? "Online" : "Offline"}</Badge>
                      {device.allowRemoteControl ? (
                        <Badge tone="info">
                          <ShieldCheck className="size-3" /> Remote control on
                        </Badge>
                      ) : (
                        <Badge tone="neutral">
                          <ShieldOff className="size-3" /> View only
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {device.platform} · runtime {device.runtimeVersion ?? "unknown"} · {device.lastSeenAt ? `last seen ${formatRelative(device.lastSeenAt)}` : "never synced"}
                    </p>
                    <p className="mt-2 text-sm text-fg-muted">
                      {device.snapshot ? `${device.snapshot.projects.length} projects · ${device.snapshot.sessions.length} sessions · ` : ""}
                      {ready.length ? `Ready: ${ready.map((p) => p.displayName).join(", ")}` : "No providers ready"}
                    </p>
                  </div>
                  <Button size="sm" variant="danger-soft" disabled={remove.isPending} onClick={() => remove.mutate(device.id)}>
                    <Trash2 /> Remove
                  </Button>
                </div>
              </article>
            );
          })
        )}
        {remove.isError ? <p className="text-sm text-danger">{errorMessage(remove.error)}</p> : null}
      </section>
      <p className="text-xs leading-relaxed text-fg-subtle">
        Paired computers connect out to this site over HTTPS; nothing on them is reachable from the internet. Removing a computer revokes its access immediately. Remote control can only be turned on from the computer itself.
      </p>
    </div>
  );
}
