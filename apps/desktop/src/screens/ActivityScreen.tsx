import { Button, EmptyState, ErrorState, MODEL_CHAT_PROJECT_ID, Skeleton, formatRelative } from "@agentic-hub/ui";
import { errorMessage, useClient, useDeveloperActivity, useUpdateRepository } from "@agentic-hub/ui/client";
import type { Project } from "@agentic-hub/ui/model";
import { ExternalLink, GitCommitHorizontal, GitPullRequest, RefreshCw, Rocket } from "lucide-react";
import type { ReactNode } from "react";
import { useAppState } from "../state/app-state";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

function ItemLink({ href, title, detail, date }: { href: string; title: string; detail: string; date?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-surface-2 focus-ring">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        <span className="block truncate text-xs text-fg-muted">{detail}</span>
      </span>
      {date ? <span className="shrink-0 text-xs text-fg-subtle">{formatRelative(date)}</span> : null}
      <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
    </a>
  );
}

export function ActivityScreen({ toolbar, project }: { toolbar: ReactNode; project?: Project }) {
  const { navigate } = useAppState();
  const client = useClient();
  const projectId = client.mode === "live" && project?.id !== MODEL_CHAT_PROJECT_ID ? project?.id : undefined;
  const activity = useDeveloperActivity(projectId);
  const update = useUpdateRepository(projectId);
  const data = activity.data;
  const state = data?.update;
  return (
    <>
      <ScreenHeader title="Developer activity" subtitle={project?.id !== MODEL_CHAT_PROJECT_ID ? project?.name : undefined} toolbar={toolbar} actions={projectId ? <Button size="sm" variant="ghost" onClick={() => void activity.refetch()} disabled={activity.isFetching}><RefreshCw className={activity.isFetching ? "animate-spin" : ""} /> Refresh</Button> : undefined} />
      <ScreenBody width="max-w-4xl">
        {!projectId ? (
          <EmptyState icon={<GitCommitHorizontal />} title="Choose a repository" description="GitHub and Vercel activity is shown for a repository on this computer." action={<Button onClick={() => navigate("repositories")}>Open repository…</Button>} />
        ) : activity.isPending ? (
          <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-44 rounded-xl" /><Skeleton className="h-44 rounded-xl" /></div>
        ) : activity.isError ? (
          <ErrorState message={errorMessage(activity.error)} onRetry={() => void activity.refetch()} />
        ) : data ? (
          <div className="space-y-6">
            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Repository update</h2>
                  <p className="mt-1 text-xs text-fg-muted">{state?.branch || "No branch"} · {state?.behind ?? 0} behind · {state?.ahead ?? 0} ahead of GitHub</p>
                </div>
                <Button size="sm" variant="primary" disabled={!state?.available || Boolean(state.blockedReason) || update.isPending} onClick={() => void update.mutate()}>
                  <RefreshCw className={update.isPending ? "animate-spin" : ""} /> {update.isPending ? "Updating…" : "Update from GitHub"}
                </Button>
              </div>
              {state?.blockedReason ? <p className="mt-2 text-xs text-warning">{state.blockedReason}</p> : state?.available ? <p className="mt-2 text-xs text-fg-muted">A fast-forward update is available. Your local changes are checked before it runs.</p> : <p className="mt-2 text-xs text-fg-muted">This checkout is up to date.</p>}
              {update.isSuccess ? <p className="mt-2 text-xs text-success">Repository updated.</p> : null}
              {update.isError ? <p className="mt-2 text-xs text-danger">{errorMessage(update.error)}</p> : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><GitCommitHorizontal className="size-4" /> GitHub</h2><p className="mt-1 text-xs text-fg-muted">{data.github.detail}</p></div>
              {data.github.connected ? (
                <>
                  <div className="px-4 py-2 text-xs font-medium text-fg-subtle">Recent commits</div>
                  {data.github.commits.length ? data.github.commits.map(commit => <ItemLink key={commit.sha} href={commit.url} title={commit.title} detail={`${commit.sha.slice(0, 7)} · ${commit.author}`} date={commit.date} />) : <p className="px-4 py-3 text-sm text-fg-muted">No recent commits.</p>}
                  <div className="border-t border-border px-4 py-2 text-xs font-medium text-fg-subtle"><GitPullRequest className="mr-1 inline size-3.5" /> Pull requests</div>
                  {data.github.pullRequests.length ? data.github.pullRequests.map(pr => <ItemLink key={pr.number} href={pr.url} title={pr.title} detail={`#${pr.number} · ${pr.state}`} date={pr.updatedAt} />) : <p className="px-4 py-3 text-sm text-fg-muted">No recent pull requests.</p>}
                </>
              ) : <p className="px-4 py-4 text-sm text-fg-muted">Sign in with <code className="font-mono">gh auth login</code> in your terminal, then refresh.</p>}
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Rocket className="size-4" /> Vercel</h2><p className="mt-1 text-xs text-fg-muted">{data.vercel.detail}</p></div>
              {data.vercel.connected ? data.vercel.deployments.length ? data.vercel.deployments.map(deployment => <ItemLink key={deployment.id} href={deployment.url} title={`${deployment.target} · ${deployment.state}`} detail={deployment.url} date={deployment.createdAt} />) : <p className="px-4 py-4 text-sm text-fg-muted">No recent deployments.</p> : <p className="px-4 py-4 text-sm text-fg-muted">Run <code className="font-mono">vercel login</code> and <code className="font-mono">vercel link</code> in this repository, then refresh.</p>}
            </section>
          </div>
        ) : null}
      </ScreenBody>
    </>
  );
}
