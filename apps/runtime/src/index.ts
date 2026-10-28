import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry, SessionManager } from '@agentic-hub/agent-core';
import { ApiChatAdapter } from '@agentic-hub/agent-api';
import { CodexAdapter } from '@agentic-hub/agent-codex';
import { ClaudeAdapter } from '@agentic-hub/agent-claude';
import { MuseAdapter } from '@agentic-hub/agent-muse';
import { Store } from '@agentic-hub/database';
import { ControlPlaneConnector, RUNTIME_VERSION } from './control-plane.js';
import { CredentialStore } from './credentials.js';
import { JobRunner } from './jobs.js';
import { createRuntimeServer } from './server.js';

const dataDir = process.env.AGENTIC_HUB_DATA_DIR ?? join(homedir(), '.agentic-hub');
process.umask(0o077);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

// One runtime per data directory: two writers would mark each other's turns interrupted.
const lockPath = join(dataDir, 'runtime.lock');
async function acquireLock(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(await readFile(lockPath, 'utf8').catch(() => ''));
      if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) {
        process.stderr.write(`Another Agentic Hub runtime (pid ${holder}) is using ${dataDir}.\n`);
        process.exit(3);
      }
      await unlink(lockPath).catch(() => {});
    }
  }
  throw new Error('Could not acquire the runtime lock');
}
await acquireLock();

// Token files left behind by a runtime that was killed are useless and are removed.
for (const name of await readdir(dataDir)) {
  const pid = Number(/^token-(\d+)$/.exec(name)?.[1]);
  if (Number.isInteger(pid) && pid > 0 && !alive(pid)) await unlink(join(dataDir, name)).catch(() => {});
}

const token = randomBytes(32).toString('hex');
const tokenPath = join(dataDir, `token-${process.pid}`);
const file = await open(tokenPath, 'wx', 0o600);
try { await file.writeFile(token); } finally { await file.close(); }

const store = new Store(join(dataDir, 'runtime.db'));
const credentials = new CredentialStore(store);
const openai = new ApiChatAdapter('openai', credentials);
const anthropic = new ApiChatAdapter('anthropic', credentials);
const registry = new AgentRegistry();
registry.register(new CodexAdapter());
registry.register(new ClaudeAdapter());
registry.register(new MuseAdapter());
registry.register(openai);
registry.register(anthropic);
const manager = new SessionManager(store, registry, { worktreeRoot: join(dataDir, 'worktrees') });
const jobs = new JobRunner();
const controlPlane = new ControlPlaneConnector(store, registry, manager);
const server = createRuntimeServer(store, registry, manager, token, {
  credentials, controlPlane, jobs, version: RUNTIME_VERSION,
  verifyCredential: (provider, apiKey) => (provider === 'openai' ? openai : anthropic).verify(apiKey),
});
const port = Number(process.env.AGENTIC_HUB_PORT ?? 43117);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid AGENTIC_HUB_PORT');
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}`;
  process.stdout.write(`Agentic Hub runtime listening on ${url}\nToken file: ${tokenPath}\n`);
  // Machine-readable line for the desktop supervisor. Contains no secret.
  process.stdout.write(`AGENTIC_HUB_READY ${JSON.stringify({ url, tokenFile: tokenPath, pid: process.pid, version: RUNTIME_VERSION })}\n`);
  controlPlane.start();
  manager.resumeQueues();
});
server.on('error', error => {
  process.stderr.write(`Runtime failed to listen: ${error.message}\n`);
  void shutdown(1);
});

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  controlPlane.stop();
  jobs.close();
  server.close();
  server.closeAllConnections();
  await manager.close().catch(() => {});
  await unlink(tokenPath).catch(() => {});
  await unlink(lockPath).catch(() => {});
  process.exit(code);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
// A supervisor that owns our stdin (the desktop app) going away means we should too.
if (process.env.AGENTIC_HUB_EXIT_WITH_PARENT === '1') {
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('close', () => void shutdown());
  process.stdin.resume();
}
