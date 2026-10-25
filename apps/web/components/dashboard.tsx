"use client";

import {
  AGENT_DISPLAY,
  AgentMark,
  ConnectionBanner,
  DeviceStatusCard,
  EmptyState,
  ErrorState,
  RunStatusIndicator,
  Skeleton,
  cn,
  formatRelative,
  isRunActive,
  type ActivityEntry,
  type AgentId,
  type SessionSummary,
} from "@agentic-hub/ui";
import { errorMessage, isUnavailable, useActivity, useConnection, useDevices, useProjects, useSessions } from "@agentic-hub/ui/client";
import { Activity, Laptop } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { REMOTE_UNAVAILABLE } from "@/lib/data-source";
import { OfflinePanel } from "./offline-panel";

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warning" | "danger" | "accent" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums tracking-tight text-fg",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      {action}
    </div>
  );
}

const ACTIVITY_DOT = { neutral: "bg-fg-subtle", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <EmptyState compact icon={<Activity />} title="No recent activity" />;
  return (
    <ol className="divide-y divide-border rounded-xl border border-border bg-surface">
      {entries.map((entry) => {
        const body = (
          <>
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", ACTIVITY_DOT[entry.tone])} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-fg">{entry.text}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
                {entry.agentId ? <AgentMark agentId={entry.agentId} size="sm" /> : null}
                {entry.projectName}
              </span>
            </span>
            <time className="shrink-0 text-2xs tabular-nums text-fg-subtle" dateTime={entry.at}>
              {formatRelative(entry.at)}
            </time>
          </>
        );
        return (
          <li key={entry.id}>
            {entry.sessionId ? (
              <Link href={`/sessions/${entry.sessionId}`} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-ring">
                {body}
              </Link>
            ) : (
              <div className="flex gap-3 px-4 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AgentStatusRow({ sessions }: { sessions: SessionSummary[] }) {
  const agents: AgentId[] = ["codex", "claude-code", "muse"];
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {agents.map((id) => {
        const mine = sessions.filter((s) => s.agentId === id);
        const live = mine.filter((s) => isRunActive(s.status));
        const last = mine[0];
        return (
          <li key={id} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
            <AgentMark agentId={id} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-fg">{AGENT_DISPLAY[id].name}</div>
              <div className="truncate text-xs text-fg-subtle">{last ? `Last used ${formatRelative(last.updatedAt)}` : "No sessions"}</div>
            </div>
            {live.length ? (
              <RunStatusIndicator status={live.some((s) => s.status === "awaiting_approval") ? "awaiting_approval" : "running"} className="shrink-0" />
            ) : (
              <span className="text-xs text-fg-subtle">Idle</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SessionTable({ sessions, projectName }: { sessions: SessionSummary[]; projectName: (id: string) => string | undefined }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {sessions.map((s) => (
        <li key={s.id}>
          <Link
            href={`/sessions/${s.id}`}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 focus-ring sm:grid-cols-[auto_1fr_130px_72px]"
          >
            <AgentMark agentId={s.agentId} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-fg">{s.title}</span>
              <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-fg-subtle">
                {projectName(s.projectId)}
                <RunStatusIndicator status={s.status} className="text-xs sm:hidden" />
              </span>
            </span>
            <RunStatusIndicator status={s.status} className="hidden sm:inline-flex" />
            <span className="text-right text-2xs tabular-nums text-fg-subtle">{formatRelative(s.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const connection = useConnection();
  const devices = useDevices();
  const sessions = useSessions();
  const projects = useProjects();
  const activity = useActivity();

  const offline = devices.isError && isUnavailable(devices.error);
  const loading = devices.isPending && !devices.isError;
  const all = sessions.data ?? [];
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name;

  return (
    <>
      {/* Offline is explained in-page by OfflinePanel; the strip only labels demo data. */}
      {connection.status === "demo" ? <ConnectionBanner connection={connection} /> : null}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Overview</h1>
            <p className="text-sm text-fg-muted">Sessions and devices across your workspace.</p>
          </div>
        </div>

        {offline ? (
          <OfflinePanel detail={errorMessage(devices.error)} />
        ) : devices.isError ? (
          <ErrorState message={errorMessage(devices.error)} onRetry={() => void devices.refetch()} />
        ) : (
          <div className="space-y-10">
            <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {loading || sessions.isPending ? (
                [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px] rounded-lg" />)
              ) : (
                <>
                  <Stat label="Devices online" value={`${devices.data?.filter((d) => d.status === "online").length ?? 0}/${devices.data?.length ?? 0}`} />
                  <Stat label="Active sessions" value={all.filter((s) => s.status === "running" || s.status === "queued").length} tone="accent" />
                  <Stat label="Awaiting approval" value={all.filter((s) => s.status === "awaiting_approval").length} tone="warning" />
                  <Stat label="Failed (7 days)" value={all.filter((s) => s.status === "failed").length} tone="danger" />
                </>
              )}
            </dl>

            <section>
              <SectionHeading title="Agents" />
              {sessions.isPending ? <Skeleton className="h-16 rounded-lg" /> : <AgentStatusRow sessions={all} />}
            </section>

            <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
              <section className="min-w-0">
                <SectionHeading
                  title="Recent sessions"
                  action={
                    <Link href="/sessions" className="text-xs text-fg-muted hover:text-fg">
                      View all
                    </Link>
                  }
                />
                {sessions.isPending ? (
                  <Skeleton className="h-64 rounded-xl" />
                ) : sessions.isError ? (
                  <ErrorState compact message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
                ) : (
                  <SessionTable sessions={all.slice(0, 6)} projectName={projectName} />
                )}
              </section>
              <section>
                <SectionHeading title="Recent activity" />
                {activity.isPending ? <Skeleton className="h-64 rounded-xl" /> : <ActivityFeed entries={activity.data ?? []} />}
              </section>
            </div>

            <section>
              <SectionHeading title="Devices" />
              {loading ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Skeleton className="h-44 rounded-xl" />
                  <Skeleton className="h-44 rounded-xl" />
                </div>
              ) : devices.data?.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {devices.data.map((d) => (
                    <DeviceStatusCard key={d.id} device={d} remoteActionsUnavailableReason={REMOTE_UNAVAILABLE} />
                  ))}
                </div>
              ) : (
                <EmptyState compact icon={<Laptop />} title="No devices linked" description="Link the desktop app to see its sessions here." />
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
