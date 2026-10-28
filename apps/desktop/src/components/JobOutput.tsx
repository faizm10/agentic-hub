import { Badge, Button, cn, formatRelative } from "@agentic-hub/ui";
import { useJobOutput } from "@agentic-hub/ui/client";
import type { Job } from "@agentic-hub/ui/model";
import { ExternalLink, Square } from "lucide-react";
import { useEffect, useRef } from "react";

const TONE = { running: "info", succeeded: "success", failed: "danger", cancelled: "neutral" } as const;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function JobStatusBadge({ status }: { status: Job["status"] }) {
  return (
    <Badge tone={TONE[status]} className="capitalize">
      {status === "running" ? <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {status}
    </Badge>
  );
}

/** Live, auto-scrolling output for one job. */
export function JobOutput({ job, onCancel, className }: { job: Job; onCancel?: () => void; className?: string }) {
  const live = useJobOutput(job.id);
  const final = live.job ?? job;
  const text = (live.output || job.output).replace(ANSI, "");
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <code className="min-w-0 flex-1 truncate font-mono text-fg">{final.command}</code>
        <span className="text-fg-subtle">{formatRelative(final.startedAt)}</span>
        {final.exitCode !== null && final.status !== "running" ? <span className="font-mono text-fg-subtle">exit {final.exitCode}</span> : null}
        <JobStatusBadge status={final.status} />
        {final.resultUrl ? (
          <a href={final.resultUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Open <ExternalLink className="size-3" />
          </a>
        ) : null}
        {final.status === "running" && onCancel ? (
          <Button size="xs" variant="ghost" onClick={onCancel}>
            <Square /> Stop
          </Button>
        ) : null}
      </div>
      <pre
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-surface-2/50 px-3 py-2 font-mono text-xs leading-relaxed text-fg"
        aria-live="polite"
      >
        {text || (final.status === "running" ? "Waiting for output…" : "No output.")}
        {live.error ? `\n[stream error: ${live.error}]` : ""}
      </pre>
    </div>
  );
}
