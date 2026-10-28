import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HubError } from '@agentic-hub/agent-core';
import type { IdeUpdateInfo } from '@agentic-hub/types';
import { RUNTIME_VERSION } from './control-plane.js';

const exec = promisify(execFile);
const RELEASES = 'https://api.github.com/repos/faizm10/agentic-hub/releases/latest';

export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)?.slice(1, 4).map(Number);
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i]! > a[i]!;
  return false;
}

export async function ideUpdate(): Promise<IdeUpdateInfo> {
  let response: Response;
  try { response = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Agentic-Hub' }, signal: AbortSignal.timeout(10_000) }); }
  catch { throw new HubError('PROVIDER_UNAVAILABLE', 503, 'Could not check GitHub releases. Try again later.'); }
  if (response.status === 404) return { currentVersion: RUNTIME_VERSION, latestVersion: null, available: false, releaseUrl: null, detail: 'No published IDE release is available yet.' };
  if (!response.ok) throw new HubError('PROVIDER_UNAVAILABLE', 503, `GitHub release check failed (${response.status}).`);
  const release = await response.json() as { tag_name?: string; html_url?: string };
  const latestVersion = release.tag_name ?? null;
  const url = release.html_url ? new URL(release.html_url) : null;
  const releaseUrl = url?.hostname === 'github.com' && url.pathname.startsWith('/faizm10/agentic-hub/releases/') ? url.toString() : null;
  const available = Boolean(latestVersion && releaseUrl && isNewerVersion(RUNTIME_VERSION, latestVersion));
  return { currentVersion: RUNTIME_VERSION, latestVersion, releaseUrl, available, detail: available ? `Version ${latestVersion} is available on GitHub.` : 'The IDE is up to date.' };
}

export async function openIdeUpdate(): Promise<void> {
  const info = await ideUpdate();
  if (!info.available || !info.releaseUrl) throw new HubError('CONFLICT', 409, 'No newer IDE release is available.');
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', info.releaseUrl] : [info.releaseUrl];
  await exec(command, args, { timeout: 10_000 });
}
