"use client";

import { Columns2, Rows2, WrapText } from "lucide-react";
import { useMemo, useState } from "react";
import type { FileDiff } from "../model/types";
import { cn } from "../lib/cn";
import { parseUnifiedDiff, toSplitRows, type DiffLine } from "../lib/diff";
import { safeStorage } from "../lib/storage";
import { Button } from "../primitives/button";
import { SegmentedControl } from "../primitives/form";
import { Tooltip } from "../primitives/tooltip";
import { DiffStat } from "./changed-files-list";

export type DiffLayout = "unified" | "split";
const LAYOUT_KEY = "agentic-hub.diff-layout";

function lineClass(kind: DiffLine["kind"] | undefined) {
  if (kind === "add") return "bg-diff-add-bg";
  if (kind === "del") return "bg-diff-del-bg";
  return "";
}
function gutterClass(kind: DiffLine["kind"] | undefined) {
  if (kind === "add") return "bg-diff-add-gutter text-diff-add-fg";
  if (kind === "del") return "bg-diff-del-gutter text-diff-del-fg";
  return "text-fg-subtle";
}

const Num = ({ n, kind }: { n?: number; kind?: DiffLine["kind"] }) => (
  <td className={cn("w-10 select-none px-2 text-right align-top tabular-nums opacity-80", gutterClass(kind))}>{n ?? ""}</td>
);

const Code = ({ line, wrap }: { line?: DiffLine; wrap: boolean }) => (
  <td className={cn("px-3 align-top", lineClass(line?.kind), !line && "bg-surface-2/60", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
    {line ? (
      <>
        <span className={cn("mr-2 inline-block w-2 select-none", line.kind === "add" ? "text-diff-add-fg" : line.kind === "del" ? "text-diff-del-fg" : "text-transparent")}>
          {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
        </span>
        {line.text || " "}
      </>
    ) : null}
  </td>
);

/**
 * Read-only unified/split diff viewer. Lightweight by design (no editor
 * bundle); swap for Monaco's diff editor only if inline editing is needed.
 */
export function DiffViewer({ diff, className, layout: layoutProp }: { diff: FileDiff; className?: string; layout?: DiffLayout }) {
  const [layoutState, setLayoutState] = useState<DiffLayout>(() => safeStorage.get(LAYOUT_KEY, "unified"));
  const [wrap, setWrap] = useState(false);
  const layout = layoutProp ?? layoutState;
  const hunks = useMemo(() => parseUnifiedDiff(diff.patch), [diff.patch]);
  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const h of hunks)
      for (const l of h.lines) {
        if (l.kind === "add") additions++;
        else if (l.kind === "del") deletions++;
      }
    return { additions, deletions };
  }, [hunks]);

  const setLayout = (next: DiffLayout) => {
    setLayoutState(next);
    safeStorage.set(LAYOUT_KEY, next);
  };

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-2/50 px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={diff.path}>
          {diff.oldPath ? (
            <>
              <span className="text-fg-subtle">{diff.oldPath} → </span>
              {diff.path}
            </>
          ) : (
            diff.path
          )}
        </span>
        <DiffStat {...stats} />
        <Tooltip content={wrap ? "Disable line wrap" : "Wrap long lines"}>
          <Button variant="ghost" size="icon-sm" aria-pressed={wrap} aria-label="Toggle line wrap" onClick={() => setWrap((w) => !w)} className={cn(wrap && "bg-surface-3 text-fg")}>
            <WrapText />
          </Button>
        </Tooltip>
        {layoutProp ? null : (
          <SegmentedControl
            label="Diff layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "unified", label: "Unified", icon: <Rows2 /> },
              { value: "split", label: "Split", icon: <Columns2 /> },
            ]}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {diff.binary ? (
          <p className="p-6 text-center text-sm text-fg-muted">Binary file — no textual diff.</p>
        ) : diff.untracked && hunks.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-muted">New untracked file. The runtime only diffs tracked files against HEAD.</p>
        ) : hunks.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-muted">No textual changes.</p>
        ) : (
          <table className="w-full border-collapse font-mono text-xs leading-5" aria-label={`Diff of ${diff.path}`}>
            {hunks.map((hunk, hi) => (
              <tbody key={hi}>
                <tr className="bg-diff-hunk-bg text-fg-subtle">
                  <td colSpan={layout === "split" ? 4 : 3} className="px-3 py-1">
                    {hunk.header.replace(/ @@.*/, " @@")}
                    {hunk.section ? <span className="ml-2 text-fg-muted">{hunk.section}</span> : null}
                  </td>
                </tr>
                {layout === "unified"
                  ? hunk.lines.map((line, li) => (
                      <tr key={li}>
                        <Num n={line.oldNumber} kind={line.kind} />
                        <Num n={line.newNumber} kind={line.kind} />
                        <Code line={line} wrap={wrap} />
                      </tr>
                    ))
                  : toSplitRows(hunk.lines).map((row, ri) => (
                      <tr key={ri}>
                        <Num n={row.left?.oldNumber} kind={row.left?.kind === "context" ? undefined : row.left?.kind} />
                        <Code line={row.left} wrap={wrap} />
                        <Num n={row.right?.newNumber} kind={row.right?.kind === "context" ? undefined : row.right?.kind} />
                        <Code line={row.right} wrap={wrap} />
                      </tr>
                    ))}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </div>
  );
}

export function DiffSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" aria-label="Loading diff">
      {[40, 70, 55, 80, 30, 65].map((w, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}