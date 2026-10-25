"use client";

import type { FileChange, FileChangeStatus } from "../model/types";
import { cn } from "../lib/cn";
import { splitPath } from "../lib/format";

const STATUS: Record<FileChangeStatus, { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-success", label: "Added" },
  modified: { letter: "M", className: "text-warning", label: "Modified" },
  deleted: { letter: "D", className: "text-danger", label: "Deleted" },
  renamed: { letter: "R", className: "text-info", label: "Renamed" },
};

export function DiffStat({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-2xs tabular-nums", className)}>
      {additions ? <span className="text-diff-add-fg">+{additions}</span> : null}
      {deletions ? <span className="text-diff-del-fg">−{deletions}</span> : null}
    </span>
  );
}

export function ChangedFilesList({
  changes,
  selectedPath,
  onSelect,
  className,
}: {
  changes: FileChange[];
  selectedPath?: string;
  onSelect?: (path: string) => void;
  className?: string;
}) {
  const totals = changes.reduce((acc, c) => ({ a: acc.a + c.additions, d: acc.d + c.deletions }), { a: 0, d: 0 });
  return (
    <div className={className}>
      <div className="flex items-center justify-between px-2 pb-1 text-xs text-fg-muted">
        <span>
          {changes.length} {changes.length === 1 ? "file" : "files"} changed
        </span>
        <DiffStat additions={totals.a} deletions={totals.d} />
      </div>
      <ul role="listbox" aria-label="Changed files" className="space-y-px">
        {changes.map((change) => {
          const { dir, name } = splitPath(change.path);
          const status = STATUS[change.status];
          const selected = change.path === selectedPath;
          return (
            <li key={change.path} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onSelect?.(change.path)}
                title={change.path}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors focus-ring",
                  selected ? "bg-accent-soft" : "hover:bg-surface-2",
                )}
              >
                <span className={cn("w-3 shrink-0 text-center font-mono text-2xs font-semibold", status.className)} aria-label={status.label}>
                  {status.letter}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  <span className={cn(selected ? "text-fg" : "text-fg/90")}>{name}</span>
                  {dir ? <span className="ml-1.5 text-fg-subtle">{dir.replace(/\/$/, "")}</span> : null}
                </span>
                <DiffStat additions={change.additions} deletions={change.deletions} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}