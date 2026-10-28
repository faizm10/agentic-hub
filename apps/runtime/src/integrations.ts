/**
 * Integrations framework. Each integration reports a connection status and an
 * overview for a repository, and exposes actions. Actions run as jobs (real
 * processes with streamed output) and carry a risk level: anything above low
 * needs explicit confirmation from the user, which the runtime enforces here
 * rather than trusting the UI. Integrations use the user's own CLI sign-ins
 * (`gh`, `vercel`); no tokens are stored by Agentic Hub.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HubError } from '@agentic-hub/agent-core';
import { branchOf, branchesOf, commitAll, logOf } from '@agentic-hub/git';
import type { ApprovalRisk, GitHubOverview, GitHubPullRequest, IntegrationAction, IntegrationStatus, Job, Project, VercelOverview } from '@agentic-hub/types';
import { githubStatus, runOrThrow, tryRun, vercelStatus } from './environment.js';
import type { JobRunner } from './jobs.js';

export interface Integration<Overview> {
  readonly id: IntegrationStatus['id'];
  status(): Promise<IntegrationStatus>;
  overview(cwd: string): Promise<Overview>;
}

type Checks = GitHubPullRequest['checks'];
export function rollupChecks(checks: { conclusion?: string | null; state?: string | null; status?: string | null }[] | null | undefined): Checks {
  if (!checks?.length) return 'none';
  const states = checks.map(c => (c.conclusion || c.state || c.status || '').toUpperCase());
  if (states.some(s => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s))) return 'failing';
  if (states.some(s => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', ''].includes(s))) return 'pending';
  return 'passing';
}

export const github: Integration<GitHubOverview> = {
  id: 'github',
  status: githubStatus,
  async overview(cwd) {
    const [status, branches, commits] = await Promise.all([githubStatus(), branchesOf(cwd).catch(() => []), logOf(cwd, 15)]);
    const overview: GitHubOverview = { status, repository: null, branches, commits, pullRequests: [], issues: [] };
    if (!status.authenticated) return overview;
    const repo = await tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], { cwd, timeout: 15_000 });
    if (!repo) { overview.status = { ...status, detail: 'This repository has no GitHub remote, or you lack access to it.' }; return overview; }
    const parsed = JSON.parse(repo) as { nameWithOwner: string; url: string; defaultBranchRef?: { name?: string } | null };
    overview.repository = { nameWithOwner: parsed.nameWithOwner, url: parsed.url, defaultBranch: parsed.defaultBranchRef?.name ?? null };
    const [prs, issues] = await Promise.all([
      tryRun('gh', ['pr', 'list', '--state', 'all', '--limit', '20', '--json', 'number,title,state,url,author,headRefName,baseRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt'], { cwd, timeout: 20_000 }),
      tryRun('gh', ['issue', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,state,url,author,labels,updatedAt'], { cwd, timeout: 20_000 }),
    ]);
    type RawPr = { number: number; title: string; state: string; url: string; author?: { login?: string }; headRefName: string; baseRefName: string; isDraft: boolean; reviewDecision?: string | null; statusCheckRollup?: { conclusion?: string; state?: string; status?: string }[]; updatedAt: string };
    overview.pullRequests = (prs ? JSON.parse(prs) as RawPr[] : []).map(pr => ({
      number: pr.number, title: pr.title, state: pr.state.toLowerCase(), url: pr.url, author: pr.author?.login ?? 'unknown', headRefName: pr.headRefName, baseRefName: pr.baseRefName,
      isDraft: pr.isDraft, reviewDecision: pr.reviewDecision || null, checks: rollupChecks(pr.statusCheckRollup), updatedAt: pr.updatedAt,
    }));
    type RawIssue = { number: number; title: string; state: string; url: string; author?: { login?: string }; labels?: { name: string }[]; updatedAt: string };
    overview.issues = (issues ? JSON.parse(issues) as RawIssue[] : []).map(issue => ({
      number: issue.number, title: issue.title, state: issue.state.toLowerCase(), url: issue.url, author: issue.author?.login ?? 'unknown', labels: (issue.labels ?? []).map(l => l.name), updatedAt: issue.updatedAt,
    }));
    return overview;
  },
};

export async function linkedVercelProject(path: string): Promise<{ projectId: string; orgId: string; projectName: string | null; cwd: string } | null> {
  for (const cwd of [path, join(path, 'apps/web')]) {
    try {
      const raw = JSON.parse(await readFile(join(cwd, '.vercel/project.json'), 'utf8')) as { projectId?: string; orgId?: string; projectName?: string };
      if (raw.projectId && raw.orgId) return { projectId: raw.projectId, orgId: raw.orgId, projectName: raw.projectName ?? null, cwd };
    } catch { /* Not linked here. */ }
  }
  return null;
}

export const vercel: Integration<VercelOverview> = {
  id: 'vercel',
  status: vercelStatus,
  async overview(cwd) {
    const [status, link] = await Promise.all([vercelStatus(), linkedVercelProject(cwd)]);
    const overview: VercelOverview = { status, project: link ? { id: link.projectId, name: link.projectName, orgId: link.orgId } : null, deployments: [] };
    if (!status.authenticated) return overview;
    if (!link) { overview.status = { ...status, detail: 'Link this repository with `vercel link` to see its deployments.' }; return overview; }
    const raw = await runOrThrow('vercel', ['api', `/v6/deployments?projectId=${encodeURIComponent(link.projectId)}&teamId=${encodeURIComponent(link.orgId)}&limit=15`, '--raw', '--non-interactive'], { cwd: link.cwd, timeout: 30_000 });
    type RawDeployment = { uid: string; url: string; state?: string; readyState?: string; target?: string | null; created?: number; inspectorUrl?: string; meta?: { githubCommitRef?: string; githubCommitMessage?: string; githubCommitSha?: string } };
    const data = JSON.parse(raw) as { deployments?: RawDeployment[] };
    overview.deployments = (data.deployments ?? []).map(d => ({
      id: d.uid, url: `https://${d.url}`, state: d.readyState ?? d.state ?? 'UNKNOWN', target: d.target ?? 'preview', createdAt: new Date(d.created ?? Date.now()).toISOString(),
      branch: d.meta?.githubCommitRef ?? null, commit: d.meta?.githubCommitMessage?.split('\n')[0] ?? d.meta?.githubCommitSha?.slice(0, 7) ?? null, inspectorUrl: d.inspectorUrl ?? null,
    }));
    return overview;
  },
};

/** Registry of integrations. Add a service by implementing `Integration` and listing it here. */
export const integrations = { github, vercel } as const;

export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  return Promise.all(Object.values(integrations).map(i => i.status()));
}

const firstUrl = (pattern: RegExp) => (output: string) => output.match(pattern)?.[0] ?? null;

/** Risk of an integration action for this repository. Anything above low needs `confirm`. */
export async function actionRisk(input: IntegrationAction, cwd: string): Promise<{ risk: ApprovalRisk; reason: string }> {
  switch (input.action) {
    case 'vercel.deploy':
      return input.target === 'production' ? { risk: 'high', reason: 'Deploys to production' } : { risk: 'medium', reason: 'Uploads this checkout to a Vercel preview' };
    case 'github.pr.merge': return { risk: 'high', reason: 'Merges into the base branch' };
    case 'git.push': {
      const branch = await branchOf(cwd);
      const remoteHead = (await tryRun('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd }))?.replace(/^origin\//, '') ?? 'main';
      return !branch || branch === remoteHead || branch === 'main' || branch === 'master'
        ? { risk: 'high', reason: `Pushes directly to ${branch ?? 'the default branch'}` }
        : { risk: 'medium', reason: `Pushes ${branch} to GitHub` };
    }
    case 'github.pr.review': return input.event === 'approve' ? { risk: 'medium', reason: 'Approves a pull request' } : { risk: 'low', reason: 'Posts a review' };
    default: return { risk: 'low', reason: 'Creates or reads data you can undo' };
  }
}

/**
 * Runs an action for a repository. Throws `CONFIRMATION_REQUIRED` (428) for a
 * non-low-risk action without `confirm`, so a caller can never skip the prompt.
 */
export async function runIntegrationAction(jobs: JobRunner, project: Project, cwd: string, input: IntegrationAction, confirm: boolean): Promise<Job> {
  const { risk, reason } = await actionRisk(input, cwd);
  if (risk !== 'low' && !confirm) throw new HubError('CONFIRMATION_REQUIRED', 428, `${reason}. Confirm to continue.`);
  const base = { projectId: project.id, kind: 'integration' as const, risk };
  switch (input.action) {
    case 'git.commit': {
      const startedAt = new Date().toISOString();
      let sha: string;
      try { sha = await commitAll(cwd, input.message); }
      catch (error) { throw new HubError('CONFLICT', 409, error instanceof Error ? error.message.split('\n').find(Boolean) ?? 'Commit failed' : 'Commit failed'); }
      return jobs.record({ ...base, title: `Commit ${sha.slice(0, 7)}`, command: `git commit -m ${JSON.stringify(input.message.split('\n')[0])}`, output: `Committed ${sha}\n`, status: 'succeeded', startedAt });
    }
    case 'git.push': {
      const branch = await branchOf(cwd);
      if (!branch) throw new HubError('CONFLICT', 409, 'Check out a branch before pushing');
      return jobs.start({ ...base, cwd, title: `Push ${branch}`, command: 'git', args: ['push', '--set-upstream', 'origin', branch], timeoutMs: 5 * 60_000 });
    }
    case 'github.pr.create': {
      const branch = await branchOf(cwd);
      if (!branch) throw new HubError('CONFLICT', 409, 'Check out a branch before opening a pull request');
      const args = ['pr', 'create', '--head', branch, '--title', input.title, '--body', input.body ?? ''];
      if (input.base) args.push('--base', input.base);
      if (input.draft) args.push('--draft');
      return jobs.start({ ...base, cwd, title: `Open pull request: ${input.title}`, command: 'gh', args, resultUrl: firstUrl(/https:\/\/github\.com\/\S+\/pull\/\d+/), timeoutMs: 2 * 60_000 });
    }
    case 'github.pr.review': {
      const flag = { approve: '--approve', comment: '--comment', 'request-changes': '--request-changes' }[input.event];
      return jobs.start({ ...base, cwd, title: `Review #${input.number} (${input.event})`, command: 'gh', args: ['pr', 'review', String(input.number), flag, '--body', input.body ?? ''], timeoutMs: 60_000 });
    }
    case 'github.pr.merge':
      return jobs.start({ ...base, cwd, title: `Merge #${input.number} (${input.method})`, command: 'gh', args: ['pr', 'merge', String(input.number), `--${input.method}`], timeoutMs: 2 * 60_000 });
    case 'github.issue.create':
      return jobs.start({ ...base, cwd, title: `Open issue: ${input.title}`, command: 'gh', args: ['issue', 'create', '--title', input.title, '--body', input.body ?? ''], resultUrl: firstUrl(/https:\/\/github\.com\/\S+\/issues\/\d+/), timeoutMs: 60_000 });
    case 'vercel.deploy': {
      const link = await linkedVercelProject(cwd);
      if (!link) throw new HubError('CONFLICT', 409, 'Link this repository with `vercel link` first');
      const args = ['deploy', '--yes', '--non-interactive'];
      if (input.target === 'production') args.push('--prod');
      return jobs.start({ ...base, cwd: link.cwd, title: input.target === 'production' ? 'Deploy to production' : 'Deploy preview', command: 'vercel', args, resultUrl: firstUrl(/https:\/\/[\w.-]+\.vercel\.app\b/), timeoutMs: 20 * 60_000 });
    }
    case 'vercel.logs': {
      const link = await linkedVercelProject(cwd);
      return jobs.start({ ...base, cwd: link?.cwd ?? cwd, title: `Build logs ${input.deploymentId.slice(0, 12)}`, command: 'vercel', args: ['inspect', input.deploymentId, '--logs', '--non-interactive'], timeoutMs: 2 * 60_000 });
    }
  }
}
