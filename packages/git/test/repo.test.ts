import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchOf, diffOf, resolveRepository } from '../src/index.js';

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
