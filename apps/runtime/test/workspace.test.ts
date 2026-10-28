import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AgentRegistry, SessionManager, type AgentAdapter } from '@agentic-hub/agent-core';
import { Store } from '@agentic-hub/database';
import type { AgentCapabilities, Job, Project, ProviderInfo, Session } from '@agentic-hub/types';
import { createRuntimeServer } from '../src/server.js';
import { parseGitHubRepository } from '../src/environment.js';
import { rollupChecks } from '../src/integrations.js';

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-ws-')); dirs.push(dir);
  const repo = join(dir, 'repo');
  const git = (...args: string[]) => exec('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args]);
  await exec('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, 'README.md'), '# hi\n');
  await git('add', '.');
  await git('commit', '-qm', 'init');
  await writeFile(join(dir, 'outside.txt'), 'secret\n');
  await symlink(join(dir, 'outside.txt'), join(repo, 'escape.txt'));
  const store = new Store(join(dir, 'db.sqlite'));
  const capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true };
  const adapter: AgentAdapter = {
    provider: 'codex', capabilities,
    readiness: async (): Promise<ProviderInfo> => ({ provider: 'codex', displayName: 'Fake', capabilities, installed: true, authenticated: true, ready: true }),
    start: async () => { throw new Error('not used'); },
  };
  const registry = new AgentRegistry(); registry.register(adapter);
  const manager = new SessionManager(store, registry, { worktreeRoot: join(dir, 'worktrees') });
  const server = createRuntimeServer(store, registry, manager, 'secret');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async <T>(path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    return { status: response.status, body: await response.json() as T };
  };
  const { body } = await call<{ project: Project }>('/projects', { method: 'POST', body: { path: repo } });
  return { dir, repo, store, manager, server, call, project: body.project, close: () => { server.close(); store.close(); } };
}

describe('workspace API', () => {
  it('lists, reads and writes files only inside the repository', async () => {
    const ws = await setup();
    try {
      const list = await ws.call<{ entries: { name: string }[] }>(`/projects/${ws.project.id}/files`);
      expect(list.body.entries.map(e => e.name)).toContain('README.md');
      expect(list.body.entries.map(e => e.name)).not.toContain('.git');
      const read = await ws.call<{ file: { content: string; language: string } }>(`/projects/${ws.project.id}/file?path=README.md`);
      expect(read.body.file).toMatchObject({ content: '# hi\n', language: 'markdown' });
      const write = await ws.call(`/projects/${ws.project.id}/file`, { method: 'PUT', body: { path: 'src.ts', content: 'export {}\n' } });
      expect(write.status).toBe(200);
      expect(await readFile(join(ws.repo, 'src.ts'), 'utf8')).toBe('export {}\n');
      for (const bad of ['../outside.txt', '/etc/hosts', 'escape.txt', '.git/config']) {
        const r = await ws.call<{ error: { code: string } }>(`/projects/${ws.project.id}/file?path=${encodeURIComponent(bad)}`);
        expect(r.status, bad).toBe(400);
      }
      const escapeWrite = await ws.call(`/projects/${ws.project.id}/file`, { method: 'PUT', body: { path: 'escape.txt', content: 'x' } });
      expect(escapeWrite.status).toBe(400);
      expect(await readFile(join(ws.dir, 'outside.txt'), 'utf8')).toBe('secret\n');
    } finally { ws.close(); }
  });

  it('runs terminal commands as jobs and streams their output', async () => {
    const ws = await setup();
    try {
      const started = await ws.call<{ job: Job }>(`/projects/${ws.project.id}/commands`, { method: 'POST', body: { command: 'echo hello && git branch --show-current' } });
      expect(started.status).toBe(202);
      const response = await fetch(`http://127.0.0.1:${(ws.server.address() as { port: number }).port}/jobs/${started.body.job.id}/stream`, { headers: { authorization: 'Bearer secret', accept: 'text/event-stream' } });
      const text = await response.text();
      expect(text).toContain('event: done');
      const job = await ws.call<{ job: Job }>(`/jobs/${started.body.job.id}`);
      expect(job.body.job).toMatchObject({ status: 'succeeded', exitCode: 0, kind: 'terminal' });
      expect(job.body.job.output).toContain('hello\nmain');
    } finally { ws.close(); }
  });

  it('requires confirmation for risky integration actions', async () => {
    const ws = await setup();
    try {
      const push = await ws.call<{ error: { code: string } }>(`/projects/${ws.project.id}/actions`, { method: 'POST', body: { input: { action: 'git.push' } } });
      expect(push.status).toBe(428);
      expect(push.body.error.code).toBe('CONFIRMATION_REQUIRED');
      const deploy = await ws.call<{ error: { code: string } }>(`/projects/${ws.project.id}/actions`, { method: 'POST', body: { input: { action: 'vercel.deploy', target: 'production' } } });
      expect(deploy.status).toBe(428);
      await writeFile(join(ws.repo, 'new.txt'), 'n\n');
      const commit = await ws.call<{ job: Job }>(`/projects/${ws.project.id}/actions`, { method: 'POST', body: { input: { action: 'git.commit', message: 'Add new file' } } });
      expect(commit.status).toBe(202);
      expect(commit.body.job.status).toBe('succeeded');
      expect((await exec('git', ['-C', ws.repo, 'log', '-1', '--format=%s'])).stdout.trim()).toBe('Add new file');
    } finally { ws.close(); }
  });

  it('creates sessions in isolated worktrees and scopes files and diffs to them', async () => {
    const ws = await setup();
    try {
      const created = await ws.call<{ session: Session }>('/sessions', { method: 'POST', body: { projectId: ws.project.id, config: { provider: 'codex' }, isolation: 'worktree' } });
      expect(created.status).toBe(201);
      const worktree = created.body.session.worktree!;
      expect(worktree.branch).toMatch(/^agentic\/codex-/);
      await writeFile(join(worktree.path, 'only-here.txt'), 'x\n');
      const files = await ws.call<{ entries: { name: string }[] }>(`/projects/${ws.project.id}/files?sessionId=${created.body.session.id}`);
      expect(files.body.entries.map(e => e.name)).toContain('only-here.txt');
      const main = await ws.call<{ entries: { name: string }[] }>(`/projects/${ws.project.id}/files`);
      expect(main.body.entries.map(e => e.name)).not.toContain('only-here.txt');
      const diff = await ws.call<{ diff: { files: { path: string }[] } }>(`/sessions/${created.body.session.id}/diff`);
      expect(diff.body.diff.files.map(f => f.path)).toEqual(['only-here.txt']);
    } finally { ws.close(); }
  });

  it('groups sessions and reports usage per provider and model', async () => {
    const ws = await setup();
    try {
      const groupId = '11111111-2222-4333-8444-555555555555';
      const created = await ws.call<{ session: Session }>('/sessions', { method: 'POST', body: { projectId: ws.project.id, config: { provider: 'codex', model: 'gpt-5.5-codex' }, groupId } });
      expect(created.body.session.groupId).toBe(groupId);
      const run = '22222222-3333-4444-8555-666666666666';
      const now = new Date().toISOString();
      const taskId = '33333333-4444-4555-8666-777777777777';
      ws.store.saveTask({ id: taskId, sessionId: created.body.session.id, prompt: 'p', createdAt: now });
      ws.store.saveRun({ id: run, taskId, sessionId: created.body.session.id, status: 'completed', startedAt: now, finishedAt: now, error: null });
      const usage = { type: 'usage' as const, model: 'gpt-5.5-codex', cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null, cumulative: true };
      ws.store.appendEvent(created.body.session.id, run, { ...usage, inputTokens: 100, outputTokens: 10 });
      ws.store.appendEvent(created.body.session.id, run, { ...usage, inputTokens: 250, outputTokens: 40 });
      const report = await ws.call<{ usage: { byModel: { provider: string; model: string; inputTokens: number; outputTokens: number; turns: number }[] } }>('/usage?days=7');
      expect(report.body.usage.byModel).toEqual([expect.objectContaining({ provider: 'codex', model: 'gpt-5.5-codex', inputTokens: 250, outputTokens: 40, turns: 2 })]);
    } finally { ws.close(); }
  });

  it('returns the approval policy with settings', async () => {
    const ws = await setup();
    try {
      const policy = { mode: 'trusted', autoApproveFileEdits: false, trustedCommands: ['make lint'] };
      const saved = await ws.call<{ approvalPolicy: unknown; autoApprove: boolean }>('/settings', { method: 'PATCH', body: { approvalPolicy: policy } });
      expect(saved.body).toMatchObject({ approvalPolicy: policy, autoApprove: true });
    } finally { ws.close(); }
  });
});

describe('helpers', () => {
  it('parses GitHub repository references', () => {
    expect(parseGitHubRepository('faizm10/agentic-hub')).toEqual({ owner: 'faizm10', repo: 'agentic-hub' });
    expect(parseGitHubRepository('https://github.com/vercel/next.js.git')).toEqual({ owner: 'vercel', repo: 'next.js' });
    expect(parseGitHubRepository('git@github.com:a/b.git')).toEqual({ owner: 'a', repo: 'b' });
    expect(parseGitHubRepository('https://evil.com/a/b')).toBeNull();
    expect(parseGitHubRepository('a/b; rm -rf /')).toBeNull();
    expect(parseGitHubRepository('a/..')).toBeNull();
  });
  it('rolls up PR check states', () => {
    expect(rollupChecks([])).toBe('none');
    expect(rollupChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('failing');
    expect(rollupChecks([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
    expect(rollupChecks([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('passing');
  });
});
