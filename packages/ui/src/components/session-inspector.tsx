"use client";

import { Activity, FileDiff as FileDiffIcon, FlaskConical, Info, Maximize2 } from "lucide-react";
import { useState } from "react";
import { useDiff } from "../client/react";
import { errorMessage } from "../client/errors";
import type { Project, SessionSnapshot } from "../model/types";
import { cn } from "../lib/cn";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../primitives/form";
import { Tooltip } from "../primitives/tooltip";
import { AgentActivityList } from "./agent-activity-list";
import { ChangedFilesList } from "./changed-files-list";
import { DiffSkeleton, DiffViewer } from "./diff-viewer";
import { SessionDetailsPanel } from "./session-details-panel";
import { EmptyState, ErrorState } from "./states";
import { TestResultsList } from "./test-results-list";

export type InspectorTab = "changes" | "activity" | "tests" | "details";

/** Right-hand review panel: changed files + diff, activity, tests and details. */
export function SessionInspector({
  snapshot,
  project,
  modeLabel,
  onOpenReview,
  tab: tabProp,
  onTabChange,
  className,
}: {
  snapshot: SessionSnapshot;
  project?: Project;
  modeLabel?: string;
  onOpenReview?: (path?: string) => void;
  tab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  className?: string;
}) {
  const [tabState, setTabState] = useState<InspectorTab>("changes");
  const tab = tabProp ?? tabState;
  const setTab = (t: InspectorTab) => {
    setTabState(t);
    onTabChange?.(t);
  };
  const [selected, setSelected] = useState<string | undefined>();
  const selectedPath = selected && snapshot.changes.some((c) => c.path === selected) ? selected : snapshot.changes[0]?.path;
  const diff = useDiff(snapshot.session.id, selectedPath);
  const activityCount = snapshot.timeline.filter((t) => t.kind === "tool").length;
  const failedTests = snapshot.tests.some((t) => t.status === "failed");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as InspectorTab)} className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <TabsList aria-label="Session inspector">
          <TabsTrigger value="changes">
            <FileDiffIcon /> Changes
            {snapshot.changes.length ? <Badge>{snapshot.changes.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity /> Activity
            {activityCount ? <Badge>{activityCount}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="tests">
            <FlaskConical /> Tests
            {failedTests ? <span className="size-1.5 rounded-full bg-danger" aria-label="failures" /> : null}
          </TabsTrigger>
          <TabsTrigger value="details" aria-label="Details">
            <Info />
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="changes" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pt-2 outline-none">
        {snapshot.changes.length === 0 ? (
          <EmptyState compact icon={<FileDiffIcon />} title="No file changes" description="Edits the agent makes in this session will appear here for review." />
        ) : (
          <>
            <ChangedFilesList changes={snapshot.changes} selectedPath={selectedPath} onSelect={setSelected} className="max-h-[40%] shrink-0 overflow-y-auto px-1" />
            <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
              {onOpenReview ? (
                <div className="flex justify-end pb-1">
                  <Tooltip content="Open full review" shortcut="mod+shift+d">
                    <Button size="xs" variant="ghost" onClick={() => onOpenReview(selectedPath)}>
                      <Maximize2 /> Review
                    </Button>
                  </Tooltip>
                </div>
              ) : null}
              {diff.isPending ? (
                <DiffSkeleton />
              ) : diff.isError ? (
                <ErrorState compact message={errorMessage(diff.error)} onRetry={() => diff.refetch()} />
              ) : diff.data ? (
                <DiffViewer diff={diff.data} layout="unified" className="min-h-0 flex-1" />
              ) : null}
            </div>
          </>
        )}
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto py-2 outline-none">
        <AgentActivityList items={snapshot.timeline} />
      </TabsContent>
      <TabsContent value="tests" className="min-h-0 flex-1 overflow-y-auto py-2 outline-none">
        {snapshot.tests.length ? (
          <TestResultsList runs={snapshot.tests} />
        ) : (
          <EmptyState compact icon={<FlaskConical />} title="No test results" description="Test runs reported by the agent show up here." />
        )}
      </TabsContent>
      <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto py-1 outline-none">
        <SessionDetailsPanel snapshot={snapshot} project={project} mode={modeLabel} />
      </TabsContent>
    </Tabs>
  );
}