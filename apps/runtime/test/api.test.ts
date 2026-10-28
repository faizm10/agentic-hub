import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry, SessionManager } from '@agentic-hub/agent-core';
import { MuseAdapter } from '@agentic-hub/agent-muse';
import type { AgentAdapter, AdapterSession } from '@agentic-hub/agent-core';
import { MODEL_CHAT_PROJECT_ID, type AgentCapabilities, type NewAgentEvent, type ProviderInfo } from '@agentic-hub/types';
import { randomUUID } from 'node:crypto';
import { Store } from '@agentic-hub/database';
import { createRuntimeServer } from '../src/server.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it('enforces bearer auth and validates request bodies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-api-')); dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const registry = new AgentRegistry(); registry.register(new MuseAdapter('/nonexistent/muse'));
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
    const settings = await fetch(`${base}/settings`, { headers: { authorization: 'Bearer secret' } }).then(response => response.json() as Promise<{ autoApprove: boolean }>);
    expect(settings.autoApprove).toBe(false);
    const enabled = await fetch(`${base}/settings`, { method: 'PATCH', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ autoApprove: true }) }).then(response => response.json() as Promise<{ autoApprove: boolean }>);
    expect(enabled.autoApprove).toBe(true);
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
  const modelCapabilities = { ...capabilities, gitDiff: false, approvals: false };
  const modelAdapter: AgentAdapter = {
    ...adapter,
    provider: 'openai', capabilities: modelCapabilities,
    readiness: async (): Promise<ProviderInfo> => ({ provider: 'openai', displayName: 'OpenAI', capabilities: modelCapabilities, installed: true, authenticated: true, ready: true, kind: 'model' }),
  };
  const registry = new AgentRegistry(); registry.register(adapter); registry.register(modelAdapter);
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
    const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };
    const projects = await fetch(`http://127.0.0.1:${address.port}/projects`, { headers }).then(response => response.json() as Promise<{ projects: { id: string }[] }>);
    expect(projects.projects.some(project => project.id === MODEL_CHAT_PROJECT_ID)).toBe(true);
    const coding = await fetch(`http://127.0.0.1:${address.port}/sessions`, { method: 'POST', headers, body: JSON.stringify({ projectId: MODEL_CHAT_PROJECT_ID, config: { provider: 'codex' } }) });
    expect(coding.status).toBe(400);
    expect((await coding.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    const chat = await fetch(`http://127.0.0.1:${address.port}/sessions`, { method: 'POST', headers, body: JSON.stringify({ projectId: MODEL_CHAT_PROJECT_ID, config: { provider: 'openai' } }) });
    expect(chat.status).toBe(201);
    const created = await chat.json() as { session: { id: string } };
    const message = await fetch(`http://127.0.0.1:${address.port}/sessions/${created.session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) });
    expect(message.status).toBe(202);
    expect(store.events(created.session.id).some(event => event.type === 'message' && event.role === 'user' && event.text === 'hello')).toBe(true);
    const chatDiff = await fetch(`http://127.0.0.1:${address.port}/sessions/${created.session.id}/diff`, { headers }).then(response => response.json() as Promise<{ diff: { files: unknown[] } }>);
    expect(chatDiff.diff.files).toEqual([]);
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
