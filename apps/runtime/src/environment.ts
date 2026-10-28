import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HubError, type AgentRegistry } from '@agentic-hub/agent-core';
import { resolveRepository } from '@agentic-hub/git';
import type { EnvironmentReport, GitHubRepoSummary, IntegrationStatus, ProviderInfo, ToolCheck } from '@agentic-hub/types';

const execFileAsync = promisify(execFile);

/** Runs a CLI and returns trimmed stdout, or null if it is missing or fails. */
export async function tryRun(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd: options.cwd, timeout: options.timeout ?? 8_000, maxBuffer: 4_000_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    return stdout.trim();
  } catch { return null; }
}

export async function runOrThrow(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd: options.cwd, timeout: options.timeout ?? 15_000, maxBuffer: 8_000_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    return stdout.trim();
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new HubError('PROVIDER_UNAVAILABLE', 503, `${command} is not installed or not on PATH.`);
    const detail = (e.stderr || e.message || '').split('\n').map(line => line.trim()).find(Boolean) ?? 'command failed';
    throw new HubError('PROVIDER_UNAVAILABLE', 502, `${command}: ${detail.slice(0, 300)}`);
  }
}

const versionOf = (output: string | null) => output?.match(/\d+\.\d+(\.\d+)?([-.\w]*)?/)?.[0] ?? null;

export async function githubStatus(): Promise<IntegrationStatus> {
  const base = { id: 'github' as const, name: 'GitHub', connectCommand: 'gh auth login --web', docsUrl: 'https://cli.github.com' };
  const version = await tryRun('gh', ['--version']);
  if (version === null) return { ...base, installed: false, authenticated: false, account: null, detail: 'Install the GitHub CLI: brew install gh' };
  const login = await tryRun('gh', ['api', 'user', '--jq', '.login'], { timeout: 10_000 });
  return login
    ? { ...base, installed: true, authenticated: true, account: login, detail: `Signed in as ${login}` }
    : { ...base, installed: true, authenticated: false, account: null, detail: 'Sign in to GitHub to import repositories and manage pull requests.' };
}

export async function vercelStatus(): Promise<IntegrationStatus> {
  const base = { id: 'vercel' as const, name: 'Vercel', connectCommand: 'vercel login', docsUrl: 'https://vercel.com/docs/cli' };
  const version = await tryRun('vercel', ['--version'], { timeout: 15_000 });
  if (version === null) return { ...base, installed: false, authenticated: false, account: null, detail: 'Install the Vercel CLI: npm i -g vercel' };
  const who = await tryRun('vercel', ['whoami', '--non-interactive'], { timeout: 15_000 });
  const account = who?.split('\n').map(line => line.trim()).filter(Boolean).pop() ?? null;
  return account
    ? { ...base, installed: true, authenticated: true, account, detail: `Signed in as ${account}` }
    : { ...base, installed: true, authenticated: false, account: null, detail: 'Sign in to Vercel to view and trigger deployments.' };
}

function fromProvider(id: 'codex' | 'claude' | 'muse', info: ProviderInfo | undefined, install: string, auth: string, docsUrl: string): ToolCheck {
  const names = { codex: 'Codex', claude: 'Claude Code', muse: 'Muse Code' };
  return {
    id, name: names[id], required: false,
    installed: Boolean(info?.installed), version: info?.version ?? null,
    authenticated: info ? info.authenticated : false, account: null,
    detail: info?.ready ? 'Ready' : info?.reason ?? 'Not detected',
    installCommand: install, authCommand: auth, docsUrl,
  };
}

export function cloneDirectory(): string {
  return process.env.AGENTIC_HUB_CLONE_DIR ?? join(homedir(), 'Developer');
}

export async function environmentReport(registry: AgentRegistry, fresh = false): Promise<EnvironmentReport> {
  const [git, node, providers, gh, vercel] = await Promise.all([
    tryRun('git', ['--version']),
    tryRun('node', ['--version']),
    registry.list(fresh).catch(() => [] as ProviderInfo[]),
    githubStatus(),
    vercelStatus(),
  ]);
  const provider = (id: string) => providers.find(p => p.provider === id);
  const nodeVersion = versionOf(node) ?? process.versions.node;
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  const tools: ToolCheck[] = [
    { id: 'git', name: 'Git', required: true, installed: git !== null, version: versionOf(git), authenticated: null, account: null, detail: git ? 'Installed' : 'Git is required for repositories, diffs and worktrees.', installCommand: 'xcode-select --install', authCommand: null, docsUrl: 'https://git-scm.com/downloads' },
    { id: 'node', name: 'Node.js', required: true, installed: true, version: nodeVersion, authenticated: null, account: null, detail: nodeOk ? 'Installed' : 'Node.js 22.13 or later is required.', installCommand: 'brew install node', authCommand: null, docsUrl: 'https://nodejs.org' },
    fromProvider('claude', provider('claude'), 'curl -fsSL https://claude.ai/install.sh | bash', 'claude', 'https://docs.claude.com/en/docs/claude-code/setup'),
    fromProvider('codex', provider('codex'), 'npm install -g @openai/codex', 'codex login', 'https://developers.openai.com/codex/cli'),
    { id: 'gh', name: 'GitHub CLI', required: false, installed: gh.installed, version: null, authenticated: gh.authenticated, account: gh.account, detail: gh.detail, installCommand: 'brew install gh', authCommand: gh.connectCommand, docsUrl: gh.docsUrl },
    { id: 'vercel', name: 'Vercel CLI', required: false, installed: vercel.installed, version: null, authenticated: vercel.authenticated, account: vercel.account, detail: vercel.detail, installCommand: 'npm install -g vercel', authCommand: vercel.connectCommand, docsUrl: vercel.docsUrl },
  ];
  if (provider('muse')) tools.push(fromProvider('muse', provider('muse'), 'curl -fsSL https://dev.meta.ai/install.sh | sh', 'muse', 'https://dev.meta.ai'));
  return { tools, cloneDirectory: cloneDirectory(), platform: process.platform };
}

/** `owner/repo`, `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo.git`. */
export function parseGitHubRepository(input: string): { owner: string; repo: string } | null {
  const match = /^(?:(?:https:\/\/github\.com\/)|(?:git@github\.com:))?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(input.trim());
  if (!match || match[2] === '.' || match[2] === '..') return null;
  return { owner: match[1]!, repo: match[2]! };
}

export async function listGitHubRepositories(): Promise<GitHubRepoSummary[]> {
  const raw = await runOrThrow('gh', ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate,updatedAt,url'], { timeout: 20_000 });
  return (JSON.parse(raw) as GitHubRepoSummary[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Clones into `<clone dir>/<repo>` (or an explicit directory) and returns the canonical path. */
export async function cloneRepository(repository: string, directory?: string): Promise<string> {
  const parsed = parseGitHubRepository(repository);
  if (!parsed) throw new HubError('VALIDATION_ERROR', 400, 'Enter a GitHub repository as owner/name or its github.com URL');
  const target = directory ?? join(cloneDirectory(), parsed.repo);
  const existing = await stat(target).catch(() => null);
  if (existing) {
    try { return await resolveRepository(target); }
    catch { throw new HubError('CONFLICT', 409, `${target} already exists and is not a Git repository. Choose another folder.`); }
  }
  const slug = `${parsed.owner}/${parsed.repo}`;
  const gh = await githubStatus();
  if (gh.authenticated) await runOrThrow('gh', ['repo', 'clone', slug, target, '--', '--quiet'], { timeout: 10 * 60_000 });
  else await runOrThrow('git', ['clone', '--quiet', `https://github.com/${slug}.git`, target], { timeout: 10 * 60_000 });
  return resolveRepository(target);
}
