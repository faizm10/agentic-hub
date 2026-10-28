import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchOf, branchesOf, createWorktree, diffOf, isSafeBranchName, logOf, resolveRepository } from '../src/index.js';

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it('finds the canonical repository and includes tracked and untracked changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-git-')); dirs.push(dir);
  const git = (...args: string[]) => exec('git', ['-C', dir, ...args]);
  await git('init', '-q', '-b', 'main');
  await writeFile(join(dir, 'tracked.txt'), 'before\n');
  await git('add', '.');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial');
  await writeFile(join(dir, 'tracked.txt'), 'after\n');
  await writeFile(join(dir, 'new.txt'), 'new\n');
  expect(await resolveRepository(join(dir, '.'))).toBe(await realpath(dir));
  expect(await branchOf(dir)).toBe('main');
  const diff = await diffOf(dir, 'project-id');
  expect(diff.patch).toContain('+after');
  expect(diff.files.map(file => [file.path, file.status]).sort()).toEqual([['new.txt', 'untracked'], ['tracked.txt', 'modified']]);
});

it('creates an isolated worktree, lists branches and commits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-git-')); dirs.push(dir);
  const git = (...args: string[]) => exec('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
  await git('init', '-q', '-b', 'main');
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await git('add', '.');
  await git('commit', '-qm', 'first');
  const tree = await createWorktree(dir, join(dir, '.worktrees', 'one'), 'agentic/test-1');
  expect(tree.branch).toBe('agentic/test-1');
  await writeFile(join(tree.path, 'b.txt'), 'b\n');
  expect((await diffOf(dir, 'p')).files.map(f => f.path)).not.toContain('b.txt');
  expect((await branchesOf(dir)).map(b => b.name)).toEqual(expect.arrayContaining(['main', 'agentic/test-1']));
  expect((await logOf(dir))[0]?.title).toBe('first');
  await expect(createWorktree(dir, join(dir, '.worktrees', 'bad'), '../evil')).rejects.toThrow('Invalid branch name');
  expect(isSafeBranchName('feature/ok-1')).toBe(true);
  expect(isSafeBranchName('-bad')).toBe(false);
});
