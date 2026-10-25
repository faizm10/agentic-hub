import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AgentCapabilities, AgentConfig, AgentEvent, AgentProvider, ApprovalDecision, NewAgentEvent, ProviderInfo, Session, Task, TaskRun } from '@agentic-hub/types';
import { Store } from '@agentic-hub/database';

export interface AdapterSession {
  readonly providerSessionId: string | null;
  send(text: string): Promise<void>;
  subscribe(listener: (event: NewAgentEvent) => void): () => void;
  cancel(): Promise<void>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<void>;
  cleanup(): Promise<void>;
}

export interface AgentAdapter {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilities;
  readiness(): Promise<ProviderInfo>;
  start(input: { cwd: string; config: AgentConfig; providerSessionId: string | null }): Promise<AdapterSession>;
}

export class HubError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

export class AgentRegistry {
  private adapters = new Map<AgentProvider, AgentAdapter>();
  register(adapter: AgentAdapter): void { this.adapters.set(adapter.provider, adapter); }
  get(provider: AgentProvider): AgentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new HubError('PROVIDER_UNAVAILABLE', 503, `${provider} is unavailable`);
    return adapter;
  }
  async list(): Promise<ProviderInfo[]> { return Promise.all([...this.adapters.values()].map(a => a.readiness())); }
}

type Active = { adapter: AdapterSession; runId: string; unsubscribe: () => void; finished: boolean; cancelRequested: boolean };

export class SessionManager {
  private active = new Map<string, Active>();
  private bus = new EventEmitter();
  constructor(readonly store: Store, readonly registry: AgentRegistry) { this.bus.setMaxListeners(0); }
  subscribe(sessionId: string, listener: (event: AgentEvent) => void): () => void {
    this.bus.on(sessionId, listener);
    return () => this.bus.off(sessionId, listener);
  }
  async create(projectId: string, config: AgentConfig): Promise<Session> {
    const project = this.store.project(projectId);
    if (!project) throw new HubError('NOT_FOUND', 404, 'Project not found');
    const adapter = this.registry.get(config.provider);
    const info = await adapter.readiness();
    if (!info.ready || !adapter.capabilities.execution) throw new HubError('PROVIDER_UNAVAILABLE', 503, info.reason ?? 'Provider is not ready');
    const now = new Date().toISOString();
    const session: Session = { id: randomUUID(), projectId, config, status: 'idle', providerSessionId: null, createdAt: now, updatedAt: now };
    this.store.saveSession(session);
    return session;
  }
  async send(sessionId: string, text: string): Promise<{ task: Task; run: TaskRun }> {
    const session = this.store.session(sessionId);
    if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
    if (this.active.has(sessionId) || session.status === 'running' || session.status === 'awaiting_approval') throw new HubError('CONFLICT', 409, 'Session already has an active turn');
    const project = this.store.project(session.projectId);
    if (!project) throw new HubError('NOT_FOUND', 404, 'Project not found');
    const adapter = this.registry.get(session.config.provider);
    const info = await adapter.readiness();
    if (!info.ready) throw new HubError('PROVIDER_UNAVAILABLE', 503, info.reason ?? 'Provider is not ready');
    const instance = await adapter.start({ cwd: project.path, config: session.config, providerSessionId: session.providerSessionId });
    const now = new Date().toISOString();
    const task: Task = { id: randomUUID(), sessionId, prompt: text, createdAt: now };
    const run: TaskRun = { id: randomUUID(), taskId: task.id, sessionId, status: 'running', startedAt: now, finishedAt: null, error: null };
    this.store.saveTask(task);
    this.store.saveRun(run);
    this.setStatus(sessionId, 'running', instance.providerSessionId);
    const active: Active = { adapter: instance, runId: run.id, unsubscribe: () => {}, finished: false, cancelRequested: false };
    active.unsubscribe = instance.subscribe(event => this.accept(sessionId, active, event));
    this.active.set(sessionId, active);
    this.append(sessionId, run.id, { type: 'message', role: 'user', text });
    void instance.send(text).then(() => this.finish(sessionId, active, active.cancelRequested ? 'cancelled' : 'completed', null)).catch(error => this.finish(sessionId, active, active.cancelRequested ? 'cancelled' : 'failed', active.cancelRequested ? null : error instanceof Error ? error.message : 'Provider failed'));
    return { task, run };
  }
  private append(sessionId: string, runId: string, event: NewAgentEvent): AgentEvent {
    const full = this.store.appendEvent(sessionId, runId, event);
    this.bus.emit(sessionId, full);
    return full;
  }
  private setStatus(id: string, status: Session['status'], providerSessionId?: string | null): Session {
    const old = this.store.session(id)!;
    const next = { ...old, status, providerSessionId: providerSessionId ?? old.providerSessionId, updatedAt: new Date().toISOString() };
    this.store.saveSession(next);
    return next;
  }
  private accept(sessionId: string, active: Active, event: NewAgentEvent): void {
    if (active.finished || this.active.get(sessionId) !== active) return;
    if (event.type === 'completed') return;
    if (event.type === 'approval_requested') {
      event = { ...event, approval: { ...event.approval, sessionId, taskRunId: active.runId } };
      this.store.saveApproval(event.approval);
      this.setStatus(sessionId, 'awaiting_approval', active.adapter.providerSessionId);
      const run = this.store.run(active.runId)!;
      this.store.saveRun({ ...run, status: 'awaiting_approval' });
    }
    this.append(sessionId, active.runId, event);
  }
  private finish(sessionId: string, active: Active, outcome: 'completed' | 'failed' | 'cancelled', error: string | null): void {
    if (active.finished) return;
    active.finished = true;
    if (error) this.append(sessionId, active.runId, { type: 'error', code: 'PROVIDER_ERROR', message: error });
    this.append(sessionId, active.runId, { type: 'completed', outcome, summary: null });
    const run = this.store.run(active.runId)!;
    this.store.saveRun({ ...run, status: outcome, finishedAt: new Date().toISOString(), error });
    this.setStatus(sessionId, outcome, active.adapter.providerSessionId);
    this.active.delete(sessionId);
    active.unsubscribe();
    void active.adapter.cleanup().catch(() => {});
  }
  async cancel(id: string): Promise<Session> {
    const session = this.store.session(id);
    if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
    const active = this.active.get(id);
    if (active) {
      active.cancelRequested = true;
      try { await active.adapter.cancel(); }
      catch { active.cancelRequested = false; throw new HubError('UNSUPPORTED_ACTION', 422, 'Provider could not cancel the turn'); }
      this.finish(id, active, 'cancelled', null);
    }
    return this.store.session(id)!;
  }
  async resolveApproval(id: string, decision: ApprovalDecision) {
    const approval = this.store.approval(id);
    if (!approval) throw new HubError('NOT_FOUND', 404, 'Approval not found');
    if (approval.status !== 'pending') throw new HubError('CONFLICT', 409, 'Approval already resolved');
    const active = this.active.get(approval.sessionId);
    if (!active) throw new HubError('CONFLICT', 409, 'Approval turn is no longer active');
    try { await active.adapter.resolveApproval(id, decision); }
    catch { throw new HubError('UNSUPPORTED_ACTION', 422, 'Provider cannot resolve this approval'); }
    if (active.finished) throw new HubError('CONFLICT', 409, 'Approval turn ended');
    const next = { ...approval, status: decision === 'approve' ? 'approved' as const : 'denied' as const, resolvedAt: new Date().toISOString() };
    this.store.saveApproval(next);
    this.append(approval.sessionId, active.runId, { type: 'approval_resolved', approvalId: id, decision });
    this.setStatus(approval.sessionId, 'running', active.adapter.providerSessionId);
    const run = this.store.run(active.runId)!;
    this.store.saveRun({ ...run, status: 'running' });
    return next;
  }
  async close(): Promise<void> {
    await Promise.all([...this.active.entries()].map(async ([id, active]) => {
      active.cancelRequested = true;
      try { await active.adapter.cancel(); } finally { this.finish(id, active, 'cancelled', null); }
    }));
    this.store.close();
  }
}

export class MuseAdapter implements AgentAdapter {
  readonly provider = 'muse';
  readonly capabilities: AgentCapabilities = { execution: false, streaming: false, interactiveMessages: false, approvals: false, cancellation: false, gitDiff: true };
  async readiness(): Promise<ProviderInfo> { return { provider: this.provider, displayName: 'Muse Code', capabilities: this.capabilities, installed: false, authenticated: false, ready: false, reason: 'Muse integration is not implemented' }; }
  async start(): Promise<AdapterSession> { throw new HubError('UNSUPPORTED_ACTION', 422, 'Muse execution is not implemented'); }
}
