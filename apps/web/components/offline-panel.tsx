"use client";

import { Button } from "@agentic-hub/ui";
import { FlaskConical, ShieldCheck, WifiOff } from "lucide-react";
import { useDataSource } from "@/lib/data-source";

/** Shown whenever the control plane is unavailable. Explains why, without faking data. */
export function OfflinePanel({ detail }: { detail?: string }) {
  const { setSource } = useDataSource();
  return (
    <section className="rounded-xl border border-border bg-surface p-6 sm:p-8" aria-labelledby="offline-title">
      <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg-muted">
        <WifiOff className="size-5" />
      </div>
      <h2 id="offline-title" className="mt-4 text-lg font-semibold tracking-tight text-fg">
        Your devices aren&rsquo;t reachable from here
      </h2>
      <p className="mt-1 max-w-xl text-sm text-fg-muted">{detail ?? "The control plane is unavailable."}</p>
      <ul className="mt-5 grid max-w-2xl gap-3 text-sm sm:grid-cols-2">
        <li className="flex gap-2.5 rounded-lg border border-border bg-surface-2/50 p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <span className="text-fg-muted">
            The browser never connects to your machine or reads your files directly. Status flows through an authenticated control plane.
          </span>
        </li>
        <li className="flex gap-2.5 rounded-lg border border-border bg-surface-2/50 p-3">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <span className="text-fg-muted">
            Your desktop app keeps working locally. Sessions appear here once a device is linked.
          </span>
        </li>
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setSource("demo")}>
          <FlaskConical /> Preview with demo data
        </Button>
        <span className="text-xs text-fg-subtle">Clearly labeled sample data. Nothing you do there affects a real device.</span>
      </div>
    </section>
  );
}
