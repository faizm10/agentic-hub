import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ChangedFile, GitDiff } from '@agentic-hub/types';

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
