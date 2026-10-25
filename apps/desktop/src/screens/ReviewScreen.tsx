import { Button, ChangedFilesList, DiffSkeleton, DiffViewer, EmptyState, ErrorState, Tooltip } from "@agentic-hub/ui";
import { errorMessage, useDiff } from "@agentic-hub/ui/client";
import type { SessionSnapshot } from "@agentic-hub/ui/model";
import { ArrowLeft, FileDiff, GitCommitHorizontal, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAppState } from "../state/app-state";
import { ScreenHeader } from "./ScreenHeader";

const GIT_PENDING = "Staging and discarding require the runtime's Git backend (pending integration).";

export function ReviewScreen({ toolbar, snapshot }: { toolbar: ReactNode; snapshot?: SessionSnapshot }) {
  const { navigate, reviewPath } = useAppState();
  const [selected, setSelected] = useState(reviewPath);
  const changes = snapshot?.changes ?? [];
  const path = selected && changes.some((c) => c.path === selected) ? selected : changes[0]?.path;
  const diff = useDiff(snapshot?.session.id, path);

  return (
    <>
      <ScreenHeader
        title="Review changes"
        subtitle={snapshot?.session.title}
        toolbar={toolbar}
        actions={
          <div className="flex items-center gap-1.5">
            <Tooltip content={GIT_PENDING}>
              <span>
                <Button size="sm" variant="ghost" disabled>
                  <Undo2 /> Discard
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={GIT_PENDING}>
              <span>
                <Button size="sm" disabled>
                  <GitCommitHorizontal /> Stage all
                </Button>
              </span>
            </Tooltip>
            <Button size="sm" variant="ghost" onClick={() => navigate("workspace")}>
              <ArrowLeft /> Back to session
            </Button>
          </div>
        }
      />
      {!snapshot || changes.length === 0 ? (
        <EmptyState icon={<FileDiff />} title="Nothing to review" description="Open a session with file changes to review its diff." />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-72 shrink-0 overflow-y-auto border-r border-border p-2 max-md:hidden">
            <ChangedFilesList changes={changes} selectedPath={path} onSelect={setSelected} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
            <select
              aria-label="Changed file"
              value={path}
              onChange={(e) => setSelected(e.target.value)}
              className="h-8 rounded-md border border-border bg-surface px-2 font-mono text-xs text-fg md:hidden"
            >
              {changes.map((c) => (
                <option key={c.path}>{c.path}</option>
              ))}
            </select>
            {diff.isPending ? (
              <DiffSkeleton />
            ) : diff.isError ? (
              <ErrorState compact message={errorMessage(diff.error)} onRetry={() => void diff.refetch()} />
            ) : (
              <DiffViewer diff={diff.data} className="min-h-0 flex-1" />
            )}
          </div>
        </div>
      )}
    </>
  );
}
