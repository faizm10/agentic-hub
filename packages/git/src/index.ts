import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChangedFile, GitBranch, GitCommit, GitDiff, Worktree } from '@agentic-hub/types';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20_000,
  });
  return stdout;
}

export async function resolveRepository(input: string): Promise<string> {
  const path = await realpath(input);
  if (!(await stat(path)).isDirectory()) throw new Error('Project path must be a directory');
  const root = (await git(path, ['rev-parse', '--show-toplevel'])).trim();
  return realpath(root);
}

export async function branchOf(cwd: string): Promise<string | null> {
  const branch = (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
  return branch || null;
}

export async function statusOf(cwd: string): Promise<ChangedFile[]> {
  const output = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const fields = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length && fields[i]; i++) {
    const entry = fields[i]!;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    const renamed = xy.includes('R') || xy.includes('C');
    const oldPath = renamed ? (fields[++i] ?? null) : null;
    const status: ChangedFile['status'] = xy === '??' ? 'untracked' : renamed ? 'renamed' : xy.includes('D') ? 'deleted' : xy.includes('A') ? 'added' : 'modified';
    files.push({ path, oldPath, status, additions: 0, deletions: 0 });
  }
  return files;
}

export async function diffOf(cwd: string, projectId: string): Promise<GitDiff> {
  const [branch, files, head] = await Promise.all([
    branchOf(cwd), statusOf(cwd), git(cwd, ['rev-parse', '--verify', 'HEAD']).then(s => s.trim()).catch(() => null),
  ]);
  const patch = head ? await git(cwd, ['diff', '--no-ext-diff', '--binary', 'HEAD', '--']) : await git(cwd, ['diff', '--no-ext-diff', '--binary', '--']);
  const numstat = head ? await git(cwd, ['diff', '--no-ext-diff', '--numstat', '-z', 'HEAD', '--']) : '';
  const stats = numstat.split('\0');
  for (const field of stats) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(field);
    if (!match) continue;
    const file = files.find(f => f.path === match[3]);
    if (file) { file.additions = Number(match[1]) || 0; file.deletions = Number(match[2]) || 0; }
  }
  return { projectId, branch, baseRef: head, patch, files };
}

/** Valid as a new branch name (subset of git check-ref-format). */
export function isSafeBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock') && !name.includes('//');
}

/** Adds a worktree on a new branch from HEAD. The main checkout is untouched. */
export async function createWorktree(repo: string, path: string, branch: string): Promise<Worktree> {
  if (!isSafeBranchName(branch)) throw new Error('Invalid branch name');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const head = (await git(repo, ['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim() || null;
  if (!head) throw new Error('The repository has no commits yet');
  await git(repo, ['worktree', 'add', '-b', branch, path, head]);
  return { path: await realpath(path), branch, baseRef: head };
}

export async function branchesOf(cwd: string): Promise<GitBranch[]> {
  const output = await git(cwd, ['for-each-ref', '--sort=-committerdate', '--count=50', '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(contents:subject)', 'refs/heads']);
  return output.split('\n').filter(Boolean).map(line => {
    const [name = '', head = '', upstream = '', subject = ''] = line.split('\0');
    return { name, current: head === '*', upstream: upstream || null, lastCommit: subject };
  });
}

export async function logOf(cwd: string, limit = 20): Promise<GitCommit[]> {
  const output = await git(cwd, ['log', `--max-count=${Math.max(1, Math.min(limit, 200))}`, '--format=%H%x00%s%x00%an%x00%aI']).catch(() => '');
  return output.split('\n').filter(Boolean).map(line => {
    const [sha = '', title = '', author = '', date = ''] = line.split('\0');
    return { sha, title, author, date };
  });
}

/** Stages everything and commits. Returns the new commit's sha. */
export async function commitAll(cwd: string, message: string): Promise<string> {
  if (!(await statusOf(cwd)).length) throw new Error('There are no changes to commit');
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '-m', message]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}
