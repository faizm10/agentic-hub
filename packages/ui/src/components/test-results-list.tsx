"use client";

import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { TestRun } from "../model/types";
import { formatDuration } from "../lib/format";

export function TestResultsList({ runs }: { runs: TestRun[] }) {
  return (
    <ul className="space-y-2 px-2">
      {runs.map((run) => (
        <li key={run.id} className="rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 px-3 py-2">
            {run.status === "passed" ? (
              <CircleCheck className="size-4 text-success" aria-label="Passed" />
            ) : run.status === "failed" ? (
              <CircleX className="size-4 text-danger" aria-label="Failed" />
            ) : (
              <LoaderCircle className="size-4 animate-spin text-accent" aria-label="Running" />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{run.name}</span>
            {run.durationMs ? <span className="text-2xs text-fg-subtle">{formatDuration(run.durationMs)}</span> : null}
          </div>
          <div className="flex gap-3 border-t border-border px-3 py-1.5 text-2xs tabular-nums">
            <span className="text-success">{run.passed} passed</span>
            <span className={run.failed ? "text-danger" : "text-fg-subtle"}>{run.failed} failed</span>
            <span className="text-fg-subtle">{run.skipped} skipped</span>
          </div>
          {run.failures?.length ? (
            <ul className="space-y-1.5 border-t border-border px-3 py-2">
              {run.failures.map((f) => (
                <li key={f.name} className="text-xs">
                  <p className="text-fg">{f.name}</p>
                  <p className="font-mono text-2xs text-danger">{f.message}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}