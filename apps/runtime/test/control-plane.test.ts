import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentRegistry, SessionManager, type AdapterSession, type AgentAdapter } from '@agentic-hub/agent-core';
import { ApiChatAdapter } from '@agentic-hub/agent-api';
import { Store } from '@agentic-hub/database';
import type { AgentCapabilities, NewAgentEvent, NewStreamDelta, ProviderInfo } from '@agentic-hub/types';
import { ControlPlaneConnector, validateControlPlaneUrl } from '../src/control-plane.js';
import { CredentialStore } from '../src/credentials.js';
import { createRuntimeServer } from '../src/server.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: false, cancellation: true, gitDiff: false, textDeltas: true };
function scripted(): AgentAdapter {
  return {
    provider: 'codex', capabilities,
    readiness: async (): Promise<ProviderInfo> => ({ provider: 'codex', displayName: 'Fake', capabilities, installed: true, authenticated: true, ready: true }),
    start: async () => {
      let listener: ((event: NewAgentEvent) => void) | null = null;
      let deltaListener: ((delta: NewStreamDelta) => void) | null = null;
      const session: AdapterSession = {
        providerSessionId: 'fake',
        send: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          deltaListener?.({ streamId: 's', kind: 'text', delta: 'po' });
          listener?.({ type: 'message', role: 'assistant', text: 'pong' });
        },
        subscribe: cb => { listener = cb; return () => { listener = null; }; },
        subscribeDeltas: cb => { deltaListener = cb; return () => { deltaListener = null; }; },
        cancel: async () => {}, resolveApproval: async () => {}, cleanup: async () => {},
      };
      return session;
    },
  };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-cp-')); dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const registry = new AgentRegistry(0);
  registry.register(scripted());
  const manager = new SessionManager(store, registry);
  const projectId = randomUUID();
  store.putProject({ id: projectId, name: 'repo', path: dir, branch: 'main', createdAt: new Date().toISOString() });
  return { dir, store, registry, manager, projectId };
}

function fakePlane() {
  const syncs: { snapshot: { sessions: { id: string; title: string | null }[]; allowRemoteControl: boolean }; events: { sequence: number }[]; acks: { id: string; ok: boolean; error?: string }[] }[] = [];
  const commands: { id: string; command: unknown }[] = [];
  let revoked = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/device/pair')) {
      const body = JSON.parse(String(init?.body)) as { code: string };
      if (body.code !== 'ABCD-1234') return Response.json({ error: { message: 'Invalid or expired code' } }, { status: 400 });
      return Response.json({ deviceId: 'dev-1', deviceToken: 'device-token' });
    }
    if (url.endsWith('/api/device/sync')) {
      if (revoked) return new Response(null, { status: 401 });
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer device-token');
      syncs.push(JSON.parse(String(init?.body)));
      return Response.json({ commands: commands.splice(0), nextSyncMs: 60_000 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, syncs, commands, revoke: () => { revoked = true; } };
}

describe('control-plane URL validation', () => {
  it('requires HTTPS except on loopback', () => {
    expect(validateControlPlaneUrl('https://hub.example.com/path')).toBe('https://hub.example.com');
    expect(validateControlPlaneUrl('http://localhost:3200')).toBe('http://localhost:3200');
    expect(() => validateControlPlaneUrl('http://hub.example.com')).toThrow('HTTPS');
    expect(() => validateControlPlaneUrl('https://user:pw@hub.example.com')).toThrow('credentials');
  });
});

describe('ControlPlaneConnector', () => {
  it('pairs, uploads snapshots and events, and refuses commands until remote control is allowed', async () => {
    const { store, registry, manager, projectId } = await setup();
    const plane = fakePlane();
    const connector = new ControlPlaneConnector(store, registry, manager, plane.fetchImpl);
    await expect(connector.pair({ controlPlaneUrl: 'https://hub.example.com', code: 'WRONG-0000' })).rejects.toThrow('Invalid or expired code');
    const status = await connector.pair({ controlPlaneUrl: 'https://hub.example.com', code: 'abcd-1234', deviceName: 'Laptop' });
    connector.stop();
    expect(status).toMatchObject({ paired: true, deviceId: 'dev-1', deviceName: 'Laptop', allowRemoteControl: false });
    // The device token is stored encrypted, never in plaintext.
    expect(await readFile(store.filename, 'utf8').catch(() => '')).not.toContain('device-token');

    const session = await manager.create(projectId, { provider: 'codex' });
    await manager.send(session.id, 'ping');
    await new Promise(resolve => setTimeout(resolve, 60));
    await connector.sync();
    connector.stop();
    const first = plane.syncs.at(-1)!;
    expect(first.snapshot.sessions[0]).toMatchObject({ id: session.id, title: 'ping' });
    expect(first.events.map(e => e.sequence)).toEqual([0, 1, 2]);

    plane.commands.push({ id: 'cmd-1', command: { type: 'send_message', sessionId: session.id, text: 'again' } });
    await connector.sync(); connector.stop();
    await connector.sync(); connector.stop();
    expect(plane.syncs.at(-1)!.acks).toEqual([{ id: 'cmd-1', ok: false, error: 'Control from the web is turned off on this device.' }]);
    expect(plane.syncs.at(-1)!.events).toEqual([]);

    connector.update({ allowRemoteControl: true }); connector.stop();
    plane.commands.push({ id: 'cmd-2', command: { type: 'send_message', sessionId: session.id, text: 'again' } });
    await connector.sync(); connector.stop();
    await new Promise(resolve => setTimeout(resolve, 60));
    await connector.sync(); connector.stop();
    const last = plane.syncs.at(-1)!;
    expect(last.acks).toEqual([{ id: 'cmd-2', ok: true, result: {} }]);
    expect(last.snapshot.allowRemoteControl).toBe(true);
    expect(store.events(session.id).filter(e => e.type === 'message' && e.role === 'user').map(e => e.type === 'message' && e.text)).toEqual(['ping', 'again']);

    plane.revoke();
    await connector.sync(); connector.stop();
    expect(connector.status()).toMatchObject({ paired: false, lastError: expect.stringContaining('removed') });
    await manager.close();
  });
});

describe('runtime routes', () => {
  it('stores API keys only after verification and never returns them', async () => {
    const { store, manager } = await setup();
    const credentials = new CredentialStore(store, {});
    const registry = new AgentRegistry(0);
    registry.register(new ApiChatAdapter('openai', credentials));
    const server = createRuntimeServer(store, registry, manager, 'secret', {
      credentials,
      verifyCredential: async (_provider, apiKey) => { if (!apiKey.startsWith('sk-good')) throw Object.assign(new Error('bad'), { status: 401 }); },
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const put = (apiKey: string) => fetch(`${base}/providers/openai/credentials`, { method: 'PUT', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) });
    try {
      const rejected = await put('sk-bad-key-1234567890');
      expect(rejected.status).toBe(400);
      expect((await rejected.json() as { error: { message: string } }).error.message).toContain('rejected the API key');
      const saved = await put('sk-good-key-1234567890');
      const text = await saved.text();
      expect(saved.status).toBe(200);
      expect(text).not.toContain('sk-good-key-1234567890');
      expect(JSON.parse(text).provider).toMatchObject({ ready: true, credential: { source: 'stored', hint: 'sk-…7890' } });
      const cleared = await fetch(`${base}/providers/openai/credentials`, { method: 'DELETE', headers: { authorization: 'Bearer secret' } });
      expect((await cleared.json() as { provider: { ready: boolean } }).provider.ready).toBe(false);
      expect((await fetch(`${base}/providers/codex/credentials`, { method: 'PUT', headers: { authorization: 'Bearer secret' } })).status).toBe(404);
    } finally {
      server.close();
      await manager.close();
    }
  });

  it('streams ephemeral deltas over SSE without event ids', async () => {
    const { store, registry, manager, projectId } = await setup();
    const server = createRuntimeServer(store, registry, manager, 'secret');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const abort = new AbortController();
    try {
      const session = await manager.create(projectId, { provider: 'codex' });
      const response = await fetch(`${base}/sessions/${session.id}/events`, { headers: { authorization: 'Bearer secret', accept: 'text/event-stream' }, signal: abort.signal });
      await manager.send(session.id, 'ping');
      const reader = response.body!.getReader();
      let text = '';
      while (!text.includes('pong')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain('event: delta\ndata: {"streamId":"s","kind":"text","delta":"po"');
      expect(text).not.toMatch(/id: [^\n]*\nevent: delta/);
    } finally {
      abort.abort();
      server.close();
      await manager.close();
    }
  });
});
