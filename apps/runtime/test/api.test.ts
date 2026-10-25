import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry, MuseAdapter, SessionManager } from '@agentic-hub/agent-core';
import type { AgentAdapter, AdapterSession } from '@agentic-hub/agent-core';
import type { AgentCapabilities, NewAgentEvent, ProviderInfo } from '@agentic-hub/types';
import { randomUUID } from 'node:crypto';
import { Store } from '@agentic-hub/database';
import { createRuntimeServer } from '../src/server.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it('enforces bearer auth and validates request bodies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-api-')); dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const registry = new AgentRegistry(); registry.register(new MuseAdapter());
  const manager = new SessionManager(store, registry);
  const server = createRuntimeServer(store, registry, manager, 'secret');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/projects`)).status).toBe(401);
    const invalid = await fetch(`${base}/projects`, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ path: '/does/not/exist' }) });
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  } finally {
    server.close();
    store.close();
  }
});

it('streams new events after the SSE response opens', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-sse-')); dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: false, cancellation: true, gitDiff: true };
  let listener: ((event: NewAgentEvent) => void) | null = null;
  const instance: AdapterSession = {
    providerSessionId: 'fake',
    send: async () => { listener?.({ type: 'message', role: 'assistant', text: 'pong' }); },
    subscribe: callback => { listener = callback; return () => { listener = null; }; },
    cancel: async () => {}, resolveApproval: async () => {}, cleanup: async () => {},
  };
  const adapter: AgentAdapter = {
    provider: 'codex', capabilities,
    readiness: async (): Promise<ProviderInfo> => ({ provider: 'codex', displayName: 'Fake', capabilities, installed: true, authenticated: true, ready: true }),
    start: async () => instance,
  };
  const registry = new AgentRegistry(); registry.register(adapter);
  const manager = new SessionManager(store, registry);
  const projectId = randomUUID();
  store.putProject({ id: projectId, name: 'test', path: dir, branch: null, createdAt: new Date().toISOString() });
  const session = await manager.create(projectId, { provider: 'codex' });
  const server = createRuntimeServer(store, registry, manager, 'secret');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const abort = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/sessions/${session.id}/events`, { headers: { authorization: 'Bearer secret', accept: 'text/event-stream' }, signal: abort.signal });
    expect(response.status).toBe(200);
    await manager.send(session.id, 'ping');
    const text = await response.body!.getReader().read().then(result => new TextDecoder().decode(result.value));
    expect(text).toContain('event: message');
    expect(text).toContain('ping');
  } finally {
    abort.abort();
    await manager.close();
    server.close();
  }
});
