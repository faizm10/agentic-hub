import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry, MuseAdapter, SessionManager } from '@agentic-hub/agent-core';
import { CodexAdapter } from '@agentic-hub/agent-codex';
import { ClaudeAdapter } from '@agentic-hub/agent-claude';
import { Store } from '@agentic-hub/database';
import { createRuntimeServer } from './server.js';

const dataDir = process.env.AGENTIC_HUB_DATA_DIR ?? join(homedir(), '.agentic-hub');
process.umask(0o077);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);
const token = randomBytes(32).toString('hex');
const tokenPath = join(dataDir, `token-${process.pid}`);
const file = await open(tokenPath, 'wx', 0o600);
try { await file.writeFile(token); } finally { await file.close(); }

const store = new Store(join(dataDir, 'runtime.db'));
const registry = new AgentRegistry();
registry.register(new CodexAdapter());
registry.register(new ClaudeAdapter());
registry.register(new MuseAdapter());
const manager = new SessionManager(store, registry);
const server = createRuntimeServer(store, registry, manager, token);
const port = Number(process.env.AGENTIC_HUB_PORT ?? 43117);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid AGENTIC_HUB_PORT');
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  process.stdout.write(`Agentic Hub runtime listening on http://127.0.0.1:${actualPort}\nToken file: ${tokenPath}\n`);
});
const shutdown = async () => {
  server.close();
  await manager.close();
  await import('node:fs/promises').then(fs => fs.unlink(tokenPath).catch(() => {}));
};
process.once('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
