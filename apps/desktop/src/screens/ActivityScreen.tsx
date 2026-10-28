import { Badge, Button, EmptyState, ErrorState, Input, MODEL_CHAT_PROJECT_ID, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, cn, formatRelative, useCopy } from "@agentic-hub/ui";
import {
  errorMessage,
  useCancelJob,
  useClient,
  useDeveloperActivity,
  useGitHubOverview,
  useIntegrationAction,
  useJobs,
  useUpdateRepository,
  useVercelOverview,
} from "@agentic-hub/ui/client";
import type { ApprovalRisk, GitHubPullRequest, IntegrationAction, IntegrationStatus, Job, Project, SessionSummary, VercelDeployment } from "@agentic-hub/ui/model";
import { Check, Copy, ExternalLink, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, Network as Github, ListChecks, MessageSquarePlus, RefreshCw, Rocket, ScrollText, Sparkles, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { JobOutput, JobStatusBadge } from "../components/JobOutput";
import { useAppState } from "../state/app-state";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

type Pending = { title: string; description: ReactNode; risk: ApprovalRisk; confirmLabel: string; input: IntegrationAction; body?: ReactNode };

function Card({ title, icon, actions, children, className }: { title: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold [&_svg]:size-4">
          {icon}
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Row({ href, title, detail, trailing, actions }: { href?: string; title: ReactNode; detail?: ReactNode; trailing?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-fg">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="truncate hover:underline focus-ring">
              {title}
            </a>
          ) : (
            <span className="truncate">{title}</span>
          )}
        </div>
        {detail ? <div className="truncate text-xs text-fg-muted">{detail}</div> : null}
      </div>
      {trailing}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/** Not signed in / not installed: show the exact command to run, with copy and re-check. */
function ConnectPrompt({ status, onRecheck, checking }: { status: IntegrationStatus; onRecheck: () => void; checking: boolean }) {
  const { copied, copy } = useCopy();
  const command = status.installed ? status.connectCommand : status.id === "github" ? "brew install gh && gh auth login --web" : "npm install -g vercel && vercel login";
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-sm text-fg-muted">{status.detail}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{command}</code>
        <Button size="xs" variant="ghost" onClick={() => copy(command)}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">Run it in the terminal (Terminal app or the one under the editor), finish signing in in your browser, then re-check. Agentic Hub uses the CLI&rsquo;s own sign-in and never stores the token.</p>
      <Button size="sm" onClick={onRecheck} disabled={checking}>
        <RefreshCw className={checking ? "animate-spin" : ""} /> Re-check
      </Button>
    </div>
  );
}

const CHECKS: Record<GitHubPullRequest["checks"], { tone: "success" | "danger" | "warning" | "neutral"; label: string }> = {
  passing: { tone: "success", label: "Checks pass" },
  failing: { tone: "danger", label: "Checks fail" },
  pending: { tone: "warning", label: "Checks running" },
  none: { tone: "neutral", label: "No checks" },
};

const DEPLOY_TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "info"> = { READY: "success", ERROR: "danger", CANCELED: "neutral", BUILDING: "info", QUEUED: "warning", INITIALIZING: "warning" };

export function ActivityScreen({ toolbar, project, session }: { toolbar: ReactNode; project?: Project; session?: SessionSummary }) {
  const { navigate, composeInNewChat } = useAppState();
  const client = useClient();
  const projectId = client.mode === "live" && project && project.id !== MODEL_CHAT_PROJECT_ID ? project.id : undefined;
  // Integration actions follow the active session's worktree, if it has one.
  const sessionId = session?.projectId === projectId && session?.worktree ? session.id : undefined;
  const [tab, setTab] = useState("github");
  const github = useGitHubOverview(projectId, sessionId, tab === "github");
  const vercel = useVercelOverview(projectId, sessionId, tab === "vercel");
  const jobs = useJobs(projectId);
  const cancelJob = useCancelJob(projectId);
  const action = useIntegrationAction(projectId, sessionId);
  const activity = useDeveloperActivity(tab === "github" ? projectId : undefined);
  const update = useUpdateRepository(projectId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [shownJob, setShownJob] = useState<Job | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [pr, setPr] = useState<{ title: string; body: string; draft: boolean } | null>(null);
  const [issue, setIssue] = useState<{ title: string; body: string } | null>(null);

  const run = (input: IntegrationAction, confirm = false) =>
    action.mutate(
      { input, confirm },
      {
        onSuccess: (job) => {
          setShownJob(job);
          setPending(null);
        },
      },
    );
  const ask = (p: Pending) => setPending(p);

  if (!projectId || !project)
    return (
      <>
        <ScreenHeader title="GitHub & Vercel" toolbar={toolbar} />
        <ScreenBody>
          <EmptyState
            icon={<Github />}
            title={client.mode === "live" ? "Choose a repository" : "Integrations need the local runtime"}
            description="Pull requests, issues, branches and deployments are shown for a repository on this computer."
            action={<Button onClick={() => navigate("repositories")}>Open repository…</Button>}
          />
        </ScreenBody>
      </>
    );

  const gh = github.data;
  const vc = vercel.data;
  const running = (jobs.data ?? []).filter((j) => j.status === "running");
  const branch = gh?.branches.find((b) => b.current);
  const fixWithAgent = (deployment: VercelDeployment, log: string) =>
    composeInNewChat(
      project.id,
      `The Vercel ${deployment.target} deployment ${deployment.url} failed. Here is the end of the build log:\n\n\`\`\`\n${log.slice(-4000)}\n\`\`\`\n\nFind the cause in this repository and fix it.`,
    );

  return (
    <>
      <ScreenHeader
        title="GitHub & Vercel"
        subtitle={sessionId ? `${project.name} · worktree ${session?.worktree?.branch}` : project.name}
        toolbar={toolbar}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void (tab === "github" ? github.refetch() : tab === "vercel" ? vercel.refetch() : jobs.refetch())}>
            <RefreshCw className={github.isFetching || vercel.isFetching ? "animate-spin" : ""} /> Refresh
          </Button>
        }
      />
      <ScreenBody width="max-w-5xl">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="github">
              <Github className="size-3.5" /> GitHub
            </TabsTrigger>
            <TabsTrigger value="vercel">
              <Rocket className="size-3.5" /> Vercel
            </TabsTrigger>
            <TabsTrigger value="activity">
              <ListChecks className="size-3.5" /> Activity {running.length ? <Badge tone="info">{running.length}</Badge> : null}
            </TabsTrigger>
          </TabsList>

          {action.isError ? <p className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{errorMessage(action.error)}</p> : null}
          {shownJob ? (
            <Card title={shownJob.title} icon={<Sparkles />} className="mb-5" actions={<Button size="xs" variant="ghost" onClick={() => setShownJob(null)}>Dismiss</Button>}>
              <JobOutput job={shownJob} onCancel={() => cancelJob.mutate(shownJob.id)} className="max-h-72" />
            </Card>
          ) : null}

          <TabsContent value="github" className="space-y-5">
            {github.isPending ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : github.isError ? (
              <ErrorState message={errorMessage(github.error)} onRetry={() => void github.refetch()} />
            ) : gh && !gh.status.authenticated ? (
              <Card title="Connect GitHub" icon={<Github />}>
                <ConnectPrompt status={gh.status} onRecheck={() => void github.refetch()} checking={github.isFetching} />
              </Card>
            ) : gh ? (
              <>
                <Card
                  title={gh.repository ? <a href={gh.repository.url} target="_blank" rel="noreferrer" className="hover:underline">{gh.repository.nameWithOwner}</a> : "Working tree"}
                  icon={<GitBranch />}
                  actions={<span className="text-xs text-fg-muted">{gh.status.detail}</span>}
                >
                  <div className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto]">
                    <form
                      className="flex min-w-0 gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (commitMessage.trim()) run({ action: "git.commit", message: commitMessage.trim() });
                        setCommitMessage("");
                      }}
                    >
                      <Input value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder={`Commit message for ${branch?.name ?? "this branch"}`} aria-label="Commit message" className="min-w-0 flex-1" />
                      <Button type="submit" size="md" disabled={!commitMessage.trim() || action.isPending}>
                        <GitCommitHorizontal /> Commit all
                      </Button>
                    </form>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          ask({
                            title: `Push ${branch?.name ?? "branch"}`,
                            description: `Pushes ${branch?.name ?? "the current branch"} to origin${branch?.name === gh.repository?.defaultBranch ? " — this is the default branch" : ""}.`,
                            risk: branch?.name === gh.repository?.defaultBranch ? "high" : "medium",
                            confirmLabel: "Push",
                            input: { action: "git.push" },
                          })
                        }
                      >
                        <Upload /> Push
                      </Button>
                      <Button variant="primary" disabled={!gh.repository} onClick={() => setPr({ title: gh.commits[0]?.title ?? "", body: "", draft: false })}>
                        <GitPullRequest /> Open pull request
                      </Button>
                    </div>
                  </div>
                  {activity.data?.update.available && !activity.data.update.blockedReason ? (
                    <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-xs">
                      <span className="flex-1 text-fg-muted">{activity.data.update.behind} new commit(s) on GitHub.</span>
                      <Button size="xs" onClick={() => update.mutate()} disabled={update.isPending}>
                        <RefreshCw className={update.isPending ? "animate-spin" : ""} /> Fast-forward
                      </Button>
                    </div>
                  ) : null}
                </Card>

                <Card title="Pull requests" icon={<GitPullRequest />}>
                  {gh.pullRequests.length ? (
                    gh.pullRequests.map((p) => (
                      <Row
                        key={p.number}
                        href={p.url}
                        title={<>#{p.number} {p.title}</>}
                        detail={<>{p.headRefName} → {p.baseRefName} · {p.author} · {formatRelative(p.updatedAt)}</>}
                        trailing={
                          <div className="hidden items-center gap-1.5 sm:flex">
                            {p.isDraft ? <Badge>Draft</Badge> : null}
                            <Badge tone={p.state === "merged" ? "info" : p.state === "open" ? "success" : "neutral"} className="capitalize">{p.state}</Badge>
                            {p.state === "open" ? <Badge tone={CHECKS[p.checks].tone}>{CHECKS[p.checks].label}</Badge> : null}
                            {p.reviewDecision ? <Badge tone={p.reviewDecision === "APPROVED" ? "success" : "warning"}>{p.reviewDecision.replace(/_/g, " ").toLowerCase()}</Badge> : null}
                          </div>
                        }
                        actions={
                          p.state === "open" ? (
                            <>
                              <Button size="xs" variant="ghost" onClick={() => composeInNewChat(project.id, `Review pull request #${p.number} ("${p.title}", branch ${p.headRefName}). Use \`gh pr diff ${p.number}\` to read it, then summarize risks and suggest concrete fixes.`)}>
                                <Sparkles /> Agent review
                              </Button>
                              <Button size="xs" variant="ghost" onClick={() => ask({ title: `Approve #${p.number}`, description: `Submits an approving review on “${p.title}”.`, risk: "medium", confirmLabel: "Approve", input: { action: "github.pr.review", number: p.number, event: "approve" } })}>
                                <Check /> Approve
                              </Button>
                              <Button size="xs" variant="ghost" onClick={() => ask({ title: `Merge #${p.number}`, description: `Squash-merges “${p.title}” into ${p.baseRefName}. This can't be undone from here.`, risk: "high", confirmLabel: "Squash and merge", input: { action: "github.pr.merge", number: p.number, method: "squash" } })}>
                                <GitMerge /> Merge
                              </Button>
                            </>
                          ) : null
                        }
                      />
                    ))
                  ) : (
                    <p className="px-4 py-3 text-sm text-fg-muted">No pull requests yet.</p>
                  )}
                </Card>

                <Card title="Open issues" icon={<MessageSquarePlus />} actions={<Button size="xs" onClick={() => setIssue({ title: "", body: "" })} disabled={!gh.repository}>New issue</Button>}>
                  {gh.issues.length ? (
                    gh.issues.map((i) => (
                      <Row
                        key={i.number}
                        href={i.url}
                        title={<>#{i.number} {i.title}</>}
                        detail={<>{i.author} · {formatRelative(i.updatedAt)}{i.labels.length ? ` · ${i.labels.join(", ")}` : ""}</>}
                        actions={
                          <Button size="xs" variant="ghost" onClick={() => composeInNewChat(project.id, `Work on GitHub issue #${i.number}: "${i.title}". Read it with \`gh issue view ${i.number}\`, implement a fix on this branch, and run the tests.`)}>
                            <Sparkles /> Start agent
                          </Button>
                        }
                      />
                    ))
                  ) : (
                    <p className="px-4 py-3 text-sm text-fg-muted">No open issues.</p>
                  )}
                </Card>

                <div className="grid gap-5 md:grid-cols-2">
                  <Card title="Branches" icon={<GitBranch />}>
                    {gh.branches.slice(0, 10).map((b) => (
                      <Row key={b.name} title={<span className="font-mono text-xs">{b.name}</span>} detail={b.lastCommit} trailing={b.current ? <Badge tone="success">current</Badge> : b.upstream ? null : <Badge>local</Badge>} />
                    ))}
                  </Card>
                  <Card title="Recent commits" icon={<GitCommitHorizontal />}>
                    {gh.commits.slice(0, 10).map((c) => (
                      <Row key={c.sha} href={gh.repository ? `${gh.repository.url}/commit/${c.sha}` : undefined} title={c.title} detail={<><span className="font-mono">{c.sha.slice(0, 7)}</span> · {c.author} · {formatRelative(c.date)}</>} />
                    ))}
                  </Card>
                </div>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="vercel" className="space-y-5">
            {vercel.isPending ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : vercel.isError ? (
              <ErrorState message={errorMessage(vercel.error)} onRetry={() => void vercel.refetch()} />
            ) : vc && !vc.status.authenticated ? (
              <Card title="Connect Vercel" icon={<Rocket />}>
                <ConnectPrompt status={vc.status} onRecheck={() => void vercel.refetch()} checking={vercel.isFetching} />
              </Card>
            ) : vc && !vc.project ? (
              <Card title="Link a Vercel project" icon={<Rocket />}>
                <div className="space-y-3 px-4 py-4 text-sm text-fg-muted">
                  <p>{vc.status.detail}</p>
                  <p>
                    Run <code className="font-mono text-fg">vercel link</code> in this repository (the terminal under the editor works), then refresh.
                  </p>
                </div>
              </Card>
            ) : vc ? (
              <Card
                title={vc.project?.name ?? "Deployments"}
                icon={<Rocket />}
                actions={
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => ask({ title: "Deploy a preview", description: "Uploads this checkout (including uncommitted changes) to a new Vercel preview deployment.", risk: "medium", confirmLabel: "Deploy preview", input: { action: "vercel.deploy", target: "preview" } })}>
                      <Rocket /> Deploy preview
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => ask({ title: "Deploy to production", description: "Builds this checkout and promotes it to your production domain. Visitors will see it as soon as it's ready.", risk: "high", confirmLabel: "Deploy to production", input: { action: "vercel.deploy", target: "production" } })}>
                      Deploy production
                    </Button>
                  </div>
                }
              >
                {vc.deployments.length ? (
                  vc.deployments.map((d) => (
                    <Row
                      key={d.id}
                      href={d.url}
                      title={
                        <>
                          <Badge tone={DEPLOY_TONE[d.state] ?? "neutral"}>{d.state.toLowerCase()}</Badge>
                          <span className="capitalize">{d.target}</span>
                          {d.commit ? <span className="truncate font-normal text-fg-muted">· {d.commit}</span> : null}
                        </>
                      }
                      detail={<>{d.branch ? `${d.branch} · ` : ""}{d.url.replace("https://", "")} · {formatRelative(d.createdAt)}</>}
                      actions={
                        <>
                          <Button size="xs" variant={d.state === "ERROR" ? "danger-soft" : "ghost"} onClick={() => run({ action: "vercel.logs", deploymentId: d.id })}>
                            <ScrollText /> {d.state === "ERROR" ? "Inspect failure" : "Logs"}
                          </Button>
                          {d.inspectorUrl ? (
                            <a href={d.inspectorUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-fg-subtle hover:text-fg focus-ring" aria-label="Open in Vercel">
                              <ExternalLink className="size-3.5" />
                            </a>
                          ) : null}
                        </>
                      }
                    />
                  ))
                ) : (
                  <p className="px-4 py-3 text-sm text-fg-muted">No deployments yet.</p>
                )}
              </Card>
            ) : null}
            {shownJob?.title.startsWith("Build logs") && shownJob.status !== "running" && vc ? (
              <FailureHelper job={shownJob} deployments={vc.deployments} onFix={fixWithAgent} />
            ) : null}
          </TabsContent>

          <TabsContent value="activity">
            <Card title="Commands and actions" icon={<ListChecks />}>
              {(jobs.data ?? []).length ? (
                (jobs.data ?? []).map((job) => (
                  <Row
                    key={job.id}
                    title={job.title}
                    detail={<><span className="font-mono">{job.command}</span> · {formatRelative(job.startedAt)}</>}
                    trailing={<JobStatusBadge status={job.status} />}
                    actions={<Button size="xs" variant="ghost" onClick={() => setShownJob(job)}>Output</Button>}
                  />
                ))
              ) : (
                <p className="px-4 py-3 text-sm text-fg-muted">Commits, pushes, pull requests, deployments and terminal commands appear here with their live output.</p>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </ScreenBody>

      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={pending.title}
          description={pending.description}
          risk={pending.risk}
          confirmLabel={pending.confirmLabel}
          busy={action.isPending}
          onConfirm={() => run(pending.input, true)}
        />
      ) : null}

      {pr ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPr(null)}
          title="Open a pull request"
          description={<>Pushes <code className="font-mono">{branch?.name}</code> to GitHub, then opens a pull request{gh?.repository?.defaultBranch ? ` into ${gh.repository.defaultBranch}` : ""}.</>}
          risk="medium"
          confirmLabel="Push and open"
          busy={action.isPending}
          onConfirm={async () => {
            const { title, body, draft } = pr;
            if (!title.trim()) return;
            try {
              const push = await action.mutateAsync({ input: { action: "git.push" }, confirm: true });
              setShownJob(push);
              const done = await waitFor(client, push.id);
              if (done.status !== "succeeded") return setPr(null);
              const opened = await action.mutateAsync({ input: { action: "github.pr.create", title: title.trim(), body, draft } });
              setShownJob(opened);
              setPr(null);
            } catch {
              /* Shown through action.error. */
            }
          }}
        >
          <div className="space-y-2">
            <Input value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} placeholder="Title" aria-label="Pull request title" />
            <Textarea value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} placeholder="Description (Markdown)" aria-label="Pull request description" rows={5} />
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <Switch checked={pr.draft} onCheckedChange={(draft) => setPr({ ...pr, draft })} /> Open as draft
            </label>
          </div>
        </ConfirmDialog>
      ) : null}

      {issue ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setIssue(null)}
          title="New issue"
          description={`Creates an issue in ${gh?.repository?.nameWithOwner ?? "this repository"}.`}
          risk="low"
          confirmLabel="Create issue"
          busy={action.isPending}
          onConfirm={() => {
            if (!issue.title.trim()) return;
            run({ action: "github.issue.create", title: issue.title.trim(), body: issue.body });
            setIssue(null);
          }}
        >
          <div className="space-y-2">
            <Input value={issue.title} onChange={(e) => setIssue({ ...issue, title: e.target.value })} placeholder="Title" aria-label="Issue title" />
            <Textarea value={issue.body} onChange={(e) => setIssue({ ...issue, body: e.target.value })} placeholder="Details (Markdown)" aria-label="Issue details" rows={5} />
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function waitFor(client: ReturnType<typeof useClient>, jobId: string): Promise<Job> {
  return new Promise((resolve, reject) => {
    const stop = client.streamJob(jobId, { onOutput: () => {}, onDone: (job) => { stop(); resolve(job); }, onError: reject });
  });
}

/** After build logs load, point at the error lines and offer to hand them to an agent. */
function FailureHelper({ job, deployments, onFix }: { job: Job; deployments: VercelDeployment[]; onFix: (deployment: VercelDeployment, log: string) => void }) {
  const id = job.command.split(" ")[2];
  const deployment = deployments.find((d) => d.id === id);
  if (!deployment || deployment.state !== "ERROR") return null;
  const errors = job.output.split("\n").filter((line) => /error|failed|cannot|not found|exit code/i.test(line)).slice(-8);
  return (
    <Card title="Why the build failed" icon={<ScrollText />} actions={<Button size="sm" variant="primary" onClick={() => onFix(deployment, job.output)}><Sparkles /> Fix with an agent</Button>}>
      {errors.length ? (
        <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed text-danger">{errors.join("\n")}</pre>
      ) : (
        <p className="px-4 py-3 text-sm text-fg-muted">No obvious error lines; see the full log above.</p>
      )}
    </Card>
  );
}
