import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentCapabilities, ApprovalDecision, NewAgentEvent, ProviderInfo } from '@agentic-hub/types';
import { Store } from '@agentic-hub/database';
import { AgentRegistry, SessionManager, type AdapterSession, type AgentAdapter } from '../src/index.js';

class FakeSession implements AdapterSession {
  providerSessionId = 'provider-session';
  listener: ((event: NewAgentEvent) => void) | null = null;
  resolve!: () => void;
  send(): Promise<void> { return new Promise(resolve => { this.resolve = resolve; }); }
  subscribe(listener: (event: NewAgentEvent) => void): () => void { this.listener = listener; return () => { this.listener = null; }; }
  async cancel(): Promise<void> { this.resolve(); }
  async resolveApproval(_id: string, _decision: ApprovalDecision): Promise<void> {}
  async cleanup(): Promise<void> {}
  emit(event: NewAgentEvent): void { this.listener?.(event); }
}
class FakeAdapter implements AgentAdapter {
  provider = 'codex' as const;
  capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true };
  instance = new FakeSession();
  async readiness(): Promise<ProviderInfo> { return { provider: this.provider, displayName: 'Fake', capabilities: this.capabilities, installed: true, authenticated: true, ready: true }; }
  async start(): Promise<AdapterSession> { return this.instance; }
}

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-test-')); dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  const projectId = randomUUID();
  store.putProject({ id: projectId, name: 'test', path: dir, branch: null, createdAt: new Date().toISOString() });
  const adapter = new FakeAdapter();
  const registry = new AgentRegistry(); registry.register(adapter);
  const manager = new SessionManager(store, registry);
  const session = await manager.create(projectId, { provider: 'codex' });
  return { store, adapter, manager, session };
}

describe('session lifecycle', () => {
  it('queues messages during a run and sends them in order', async () => {
    const { store, adapter, manager, session } = await setup();
    await manager.sendOrQueue(session.id, 'first');
    const second = await manager.sendOrQueue(session.id, 'second');
    expect(second).toHaveProperty('queued');
    expect(store.queuedMessages(session.id).map(item => item.text)).toEqual(['second']);
    adapter.instance.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    expect(store.events(session.id).filter(event => event.type === 'message' && event.role === 'user').map(event => event.text)).toEqual(['first', 'second']);
    expect(store.queuedMessages(session.id)).toEqual([]);
    await manager.cancel(session.id);
    store.close();
  });

  it('auto-approves only low-risk requests under the trusted policy', async () => {
    const { store, adapter, manager, session } = await setup();
    expect(manager.autoApprove()).toBe(false);
    manager.setAutoApprove(true);
    expect(manager.approvalPolicy().mode).toBe('trusted');
    await manager.send(session.id, 'work');
    const request = (id: string, description: string) => adapter.instance.emit({ type: 'approval_requested', approval: { id, sessionId: '', taskRunId: '', toolName: 'shell', description, status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null } });
    const safe = randomUUID();
    request(safe, 'Run tests — pnpm test');
    await new Promise(resolve => setImmediate(resolve));
    expect(store.approval(safe)).toMatchObject({ status: 'approved', risk: 'low', autoApproved: true });
    expect(store.session(session.id)?.status).toBe('running');
    const risky = randomUUID();
    request(risky, 'Push — git push --force origin main');
    await new Promise(resolve => setImmediate(resolve));
    expect(store.approval(risky)).toMatchObject({ status: 'pending', risk: 'high' });
    const unknown = randomUUID();
    request(unknown, 'Install — npm install left-pad');
    await new Promise(resolve => setImmediate(resolve));
    expect(store.approval(unknown)).toMatchObject({ status: 'pending', risk: 'medium' });
    await manager.cancel(session.id);
    store.close();
  });

  it('never auto-approves in ask mode, and migrates the legacy switch', async () => {
    const { store, adapter, manager, session } = await setup();
    store.setSecret('settings:autoApprove', 'true');
    expect(manager.approvalPolicy()).toEqual({ mode: 'trusted', autoApproveFileEdits: true, trustedCommands: [] });
    manager.setApprovalPolicy({ mode: 'ask', autoApproveFileEdits: true, trustedCommands: [] });
    await manager.send(session.id, 'work');
    const id = randomUUID();
    adapter.instance.emit({ type: 'approval_requested', approval: { id, sessionId: '', taskRunId: '', toolName: 'shell', description: 'Run — ls', status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null } });
    await new Promise(resolve => setImmediate(resolve));
    expect(store.approval(id)).toMatchObject({ status: 'pending', risk: 'low' });
    await manager.cancel(session.id);
    store.close();
  });

  it('resumes an encrypted queued message after a runtime restart', async () => {
    const { store, manager, session } = await setup();
    await manager.send(session.id, 'first');
    await manager.sendOrQueue(session.id, 'after restart');
    const filename = store.filename;
    await manager.close();
    const recovered = new Store(filename);
    expect(recovered.queuedMessages(session.id).map(item => item.text)).toEqual(['after restart']);
    const adapter = new FakeAdapter();
    const registry = new AgentRegistry(); registry.register(adapter);
    const resumed = new SessionManager(recovered, registry);
    resumed.resumeQueues();
    await new Promise(resolve => setImmediate(resolve));
    expect(recovered.events(session.id).filter(event => event.type === 'message' && event.role === 'user').map(event => event.text)).toEqual(['first', 'after restart']);
    expect(recovered.queuedMessages(session.id)).toEqual([]);
    await resumed.cancel(session.id);
    recovered.close();
  });

  it('rejects a second turn while the first adapter is starting', async () => {
    const { store, adapter, manager, session } = await setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    adapter.start = async () => { await gate; return adapter.instance; };
    const first = manager.send(session.id, 'first');
    await expect(manager.send(session.id, 'second')).rejects.toMatchObject({ code: 'CONFLICT' });
    release();
    await first;
    await manager.cancel(session.id);
    store.close();
  });

  it('persists ordered events and resolves an approval before continuing', async () => {
    const { store, adapter, manager, session } = await setup();
    const { run } = await manager.send(session.id, 'do work');
    const approvalId = randomUUID();
    adapter.instance.emit({ type: 'tool_start', toolCallId: 'tool-1', toolName: 'shell', description: 'run tests' });
    adapter.instance.emit({ type: 'approval_requested', approval: { id: approvalId, sessionId: '', taskRunId: '', toolName: 'shell', description: 'run tests', status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null } });
    expect(store.session(session.id)?.status).toBe('awaiting_approval');
    expect(store.approval(approvalId)?.taskRunId).toBe(run.id);
    await manager.resolveApproval(approvalId, 'approve');
    expect(store.session(session.id)?.status).toBe('running');
    adapter.instance.resolve();
    await new Promise(resolve => setImmediate(resolve));
    expect(store.session(session.id)?.status).toBe('completed');
    const events = store.events(session.id);
    expect(events.map(event => event.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(events.at(-1)?.type).toBe('completed');
    store.close();
  });

  it('cancels once and marks active runs interrupted after restart', async () => {
    const { store, manager, session } = await setup();
    await manager.send(session.id, 'cancel me');
    await manager.cancel(session.id);
    await new Promise(resolve => setImmediate(resolve));
    expect(store.session(session.id)?.status).toBe('cancelled');
    expect(store.events(session.id).filter(event => event.type === 'completed')).toHaveLength(1);
    const { run } = await manager.send(session.id, 'new run');
    store.close();
    const recovered = new Store(store.filename);
    expect(recovered.session(session.id)?.status).toBe('interrupted');
    expect(recovered.run(run.id)?.status).toBe('interrupted');
    recovered.close();
  });
});
