import {
  AGENT_DISPLAY,
} from "@agentic-hub/ui/model";
import {
  AgentMark,
  DisconnectedState,
  EmptyState,
  ErrorState,
  Input,
  RunStatusIndicator,
  SegmentedControl,
  Skeleton,
  formatRelative,
  groupSessions,
} from "@agentic-hub/ui";
import { errorMessage, isUnavailable, useProjects, useSessions } from "@agentic-hub/ui/client";
import type { AgentId, RunStatus } from "@agentic-hub/ui/model";
import { History, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useAppState } from "../state/app-state";
import { ScreenHeader } from "./ScreenHeader";

type StatusFilter = "all" | "active" | "completed" | "failed";
const ACTIVE: RunStatus[] = ["queued", "running", "awaiting_approval", "cancelling"];

export function HistoryScreen({ toolbar }: { toolbar: ReactNode }) {
  const { selectSession } = useAppState();
  const sessions = useSessions();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<AgentId | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (sessions.data ?? []).filter(
      (s) =>
        (!q || s.title.toLowerCase().includes(q)) &&
        (agent === "all" || s.agentId === agent) &&
        (status === "all" ||
          (status === "active" && ACTIVE.includes(s.status)) ||
          (status === "completed" && s.status === "completed") ||
          (status === "failed" && (s.status === "failed" || s.status === "cancelled"))),
    );
    return groupSessions(list, "date");
  }, [sessions.data, query, agent, status]);

  return (
    <>
      <ScreenHeader title="Session history" subtitle={sessions.data ? `${sessions.data.length} sessions` : undefined} toolbar={toolbar} />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" className="pl-8" />
        </div>
        <SegmentedControl<AgentId | "all">
          label="Filter by agent"
          value={agent}
          onChange={setAgent}
          options={[{ value: "all", label: "All agents" }, ...(["codex", "claude-code", "muse"] as const).map((id) => ({ value: id, label: AGENT_DISPLAY[id].name }))]}
        />
        <SegmentedControl<StatusFilter>
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Any status" },
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed / cancelled" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-4">
          {sessions.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : sessions.isError ? (
            isUnavailable(sessions.error) ? (
              <DisconnectedState detail={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
            ) : (
              <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
            )
          ) : groups.length === 0 ? (
            <EmptyState icon={<History />} title="No matching sessions" description="Try a different search or filter." />
          ) : (
            groups.map((group) => (
              <section key={group.key} className="mb-6" aria-label={group.label}>
                <h2 className="mb-1.5 px-2 text-xs font-medium text-fg-subtle">{group.label}</h2>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {group.sessions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectSession(s.id, s.projectId)}
                        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-ring sm:grid-cols-[auto_1fr_140px_120px_70px]"
                      >
                        <AgentMark agentId={s.agentId} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-fg">{s.title}</span>
                          <span className="block truncate text-2xs text-fg-subtle sm:hidden">{projects.data?.find((p) => p.id === s.projectId)?.name}</span>
                        </span>
                        <span className="hidden truncate text-xs text-fg-muted sm:block">{projects.data?.find((p) => p.id === s.projectId)?.name}</span>
                        <RunStatusIndicator status={s.status} className="hidden sm:inline-flex" />
                        <span className="text-right text-2xs tabular-nums text-fg-subtle">{formatRelative(s.updatedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
