import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DeveloperActivity } from '@agentic-hub/types';
import { HubError } from '@agentic-hub/agent-core';

const runFile = promisify(execFile);
const run = async (command: string, args: string[], cwd: string, timeout = 15_000) =>
  (await runFile(command, args, { cwd, timeout, maxBuffer: 2_000_000, env: { ...process.env, NO_COLOR: '1' } })).stdout.trim();
const message = (error: unknown) => error instanceof Error ? error.message.split('\n')[0]!.slice(0, 240) : 'Connection unavailable';

function githubRepository(remote: string): { owner: string; repo: string; url: string } | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote);
  return match ? { owner: match[1]!, repo: match[2]!, url: `https://github.com/${match[1]}/${match[2]}` } : null;
}

async function linkedVercelProject(path: string): Promise<{ projectId: string; orgId: string; cwd: string } | null> {
  for (const cwd of [path, join(path, 'apps/web')]) {
    try {
      const raw = JSON.parse(await readFile(join(cwd, '.vercel/project.json'), 'utf8')) as { projectId?: string; orgId?: string };
      if (raw.projectId && raw.orgId) return { projectId: raw.projectId, orgId: raw.orgId, cwd };
    } catch { /* The project has not been linked here. */ }
  }
  return null;
}

async function githubJson<T>(endpoint: string, path: string): Promise<{ data: T; publicApi: boolean }> {
  try { return { data: JSON.parse(await run('gh', ['api', endpoint], path)) as T, publicApi: false }; }
  catch {
    // Public repositories still work when the user has not signed in to gh.
    const response = await fetch(`https://api.github.com/${endpoint}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Agentic-Hub' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}. Sign in with gh auth login for private repositories.`);
    return { data: await response.json() as T, publicApi: true };
  }
}

export async function updateState(path: string): Promise<DeveloperActivity['update']> {
  const branch = await run('git', ['branch', '--show-current'], path);
  const result: DeveloperActivity['update'] = { available: false, behind: 0, ahead: 0, branch };
  if (!branch) return { ...result, blockedReason: 'Check out a branch before updating.' };
  const clean = !(await run('git', ['status', '--porcelain'], path));
  try { await run('git', ['fetch', '--no-tags', 'origin', branch], path, 30_000); }
  catch (error) { return { ...result, blockedReason: `Could not check GitHub: ${message(error)}` }; }
  const counts = (await run('git', ['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'], path)).split(/\s+/).map(Number);
  const ahead = counts[0] ?? 0;
  const behind = counts[1] ?? 0;
  return {
    available: behind > 0,
    ahead, behind, branch,
    ...(!clean ? { blockedReason: 'Commit or stash local changes before updating.' } : ahead > 0 && behind > 0 ? { blockedReason: 'Branches have diverged. Resolve this in Git first.' } : {}),
  };
}

export async function updateRepository(path: string): Promise<void> {
  const state = await updateState(path);
  if (state.blockedReason) throw new HubError('CONFLICT', 409, state.blockedReason);
  if (!state.available) throw new HubError('CONFLICT', 409, 'This repository is already up to date.');
  if (await run('git', ['status', '--porcelain'], path)) throw new HubError('CONFLICT', 409, 'Commit or stash local changes before updating.');
  await run('git', ['merge', '--ff-only', 'FETCH_HEAD'], path, 30_000);
}

export async function developerActivity(path: string): Promise<DeveloperActivity> {
  const [remoteResult, updateResult, link] = await Promise.allSettled([
    run('git', ['remote', 'get-url', 'origin'], path),
    updateState(path),
    linkedVercelProject(path),
  ]);
  const remote = remoteResult.status === 'fulfilled' ? githubRepository(remoteResult.value) : null;
  const update = updateResult.status === 'fulfilled' ? updateResult.value : { available: false, behind: 0, ahead: 0, branch: '', blockedReason: message(updateResult.reason) };
  const github: DeveloperActivity['github'] = { connected: false, detail: remote ? 'Connect GitHub with `gh auth login`.' : 'Set a github.com origin remote to view GitHub activity.', ...(remote ? { repositoryUrl: remote.url } : {}), commits: [], pullRequests: [] };
  const vercel: DeveloperActivity['vercel'] = { connected: false, detail: 'Link this project with `vercel link` to view deployments.', deployments: [] };
  await Promise.all([
    (async () => {
      if (!remote) return;
      try {
        const base = `repos/${remote.owner}/${remote.repo}`;
        const [commitsResult, pullsResult] = await Promise.all([
          githubJson<{ sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } }[]>(`${base}/commits?per_page=10`, path),
          githubJson<{ number: number; title: string; html_url: string; updated_at: string; state: string; merged_at: string | null }[]>(`${base}/pulls?state=all&per_page=10`, path),
        ]);
        const commits = commitsResult.data;
        const pulls = pullsResult.data;
        github.connected = true;
        github.detail = commitsResult.publicApi || pullsResult.publicApi ? `${remote.url} · public activity` : remote.url;
        github.commits = commits.map(commit => ({ sha: commit.sha, title: commit.commit.message.split('\n')[0] ?? '', author: commit.author?.login ?? commit.commit.author?.name ?? 'Unknown', date: commit.commit.author?.date ?? '', url: commit.html_url }));
        github.pullRequests = pulls.map(pr => ({ number: pr.number, title: pr.title, url: pr.html_url, updatedAt: pr.updated_at, state: pr.merged_at ? 'merged' : pr.state }));
      } catch (error) { github.detail = `GitHub unavailable: ${message(error)}`; }
    })(),
    (async () => {
      if (link.status !== 'fulfilled' || !link.value) return;
      try {
        const { projectId, orgId, cwd } = link.value;
        const raw = await run('vercel', ['api', `/v6/deployments?projectId=${encodeURIComponent(projectId)}&teamId=${encodeURIComponent(orgId)}&limit=10`, '--raw', '--non-interactive'], cwd, 30_000);
        const data = JSON.parse(raw) as { deployments?: { uid: string; url: string; state?: string; readyState?: string; target?: string; created?: number }[] };
        vercel.connected = true;
        vercel.detail = 'Recent deployments for this Vercel project.';
        vercel.deployments = (data.deployments ?? []).map(item => ({ id: item.uid, url: `https://${item.url}`, state: item.readyState ?? item.state ?? 'UNKNOWN', target: item.target ?? 'preview', createdAt: new Date(item.created ?? Date.now()).toISOString() }));
      } catch (error) { vercel.detail = `Vercel unavailable: ${message(error)}`; }
    })(),
  ]);
  return { github, vercel, update };
}
