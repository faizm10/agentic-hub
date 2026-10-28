import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ApprovalPolicySchema, DEFAULT_APPROVAL_POLICY, MODEL_CHAT_PROJECT_ID } from '@agentic-hub/types';
import type { ApprovalPolicy, Project, Worktree } from '@agentic-hub/types';
import { createWorktree } from '@agentic-hub/git';
import { assessApproval, shouldAutoApprove } from './approval-policy.js';
import type { AgentConfig, AgentEvent, AgentProvider, ApprovalDecision, ModelInfo, NewAgentEvent, NewStreamDelta, AgentCapabilities, ProviderInfo, Session, StreamDelta, Task, TaskRun } from '@agentic-hub/types';
import { Store, redactStoredText } from '@agentic-hub/database';

export interface AdapterSession {
  readonly providerSessionId: string | null;
  send(text: string): Promise<void>;
  subscribe(listener: (event: NewAgentEvent) => void): () => void;
  /** Ephemeral partial text. The complete message event that follows is authoritative. */
  subscribeDeltas?(listener: (delta: NewStreamDelta) => void): () => void;
  cancel(): Promise<void>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<void>;
  cleanup(): Promise<void>;
}

export interface StartInput {
  cwd: string;
  config: AgentConfig;
  providerSessionId: string | null;
  /** Earlier turns of this session, oldest first. Stateless API providers resend them. */
  history: { role: 'user' | 'assistant'; text: string }[];
}

export interface AgentAdapter {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilities;
  readiness(): Promise<ProviderInfo>;
  start(input: StartInput): Promise<AdapterSession>;
  /** Models the provider currently offers. Only called when `capabilities.modelDiscovery`. */
  models?(): Promise<ModelInfo[]>;
}

/** Where API-key providers read their key. Implemented by the runtime over the encrypted store and environment. */
export interface CredentialSource {
  get(provider: AgentProvider): { apiKey: string; source: 'stored' | 'environment' } | null;
}

/** `sk-…abcd`: enough to recognise a key without revealing it. */
export function credentialHint(apiKey: string): string {
  const prefix = /^(sk-ant-|sk-proj-|sk-)/.exec(apiKey)?.[0] ?? '';
  return `${prefix}…${apiKey.slice(-4)}`;
}

/** Turns provider SDK errors into short, credential-free messages. */
export function providerErrorMessage(error: unknown, provider: string): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : NaN;
  if (status === 401) return `${provider} rejected the API key. Update it in Settings → Providers.`;
  if (status === 403) return `${provider} denied access for this API key or model.`;
  if (status === 404) return `${provider} could not find that model.`;
  if (status === 429) return `${provider} rate limit or quota exceeded. Check your plan and billing.`;
  if (status >= 500) return `${provider} is temporarily unavailable (${status}).`;
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]').slice(0, 500) || `${provider} request failed`;
}

export * from './approval-policy.js';

export class HubError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

export class AgentRegistry {
  private adapters = new Map<AgentProvider, AgentAdapter>();
  private cache = new Map<AgentProvider, { at: number; value: Promise<ProviderInfo> }>();
  private models = new Map<AgentProvider, { at: number; value: Promise<ModelInfo[]> }>();
  /** CLI readiness checks spawn processes, so results are reused briefly. */
  constructor(private readonly ttlMs = 15_000) {}
  register(adapter: AgentAdapter): void { this.adapters.set(adapter.provider, adapter); }
  get(provider: AgentProvider): AgentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new HubError('PROVIDER_UNAVAILABLE', 503, `${provider} is unavailable`);
    return adapter;
  }
  has(provider: AgentProvider): boolean { return this.adapters.has(provider); }
  readiness(provider: AgentProvider, fresh = false): Promise<ProviderInfo> {
    const adapter = this.get(provider);
    const hit = this.cache.get(provider);
    if (!fresh && hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = adapter.readiness();
    this.cache.set(provider, { at: Date.now(), value });
    value.catch(() => this.cache.delete(provider));
    return value;
  }
  async list(fresh = false): Promise<ProviderInfo[]> { return Promise.all([...this.adapters.keys()].map(p => this.readiness(p, fresh))); }
  /** Forget cached readiness and models, e.g. after a credential change. */
  invalidate(provider?: AgentProvider): void {
    if (provider) { this.cache.delete(provider); this.models.delete(provider); }
    else { this.cache.clear(); this.models.clear(); }
  }
  async listModels(provider: AgentProvider): Promise<ModelInfo[]> {
    const adapter = this.get(provider);
    if (!adapter.capabilities.modelDiscovery || !adapter.models) throw new HubError('UNSUPPORTED_ACTION', 422, `${provider} does not support model discovery`);
    const info = await this.readiness(provider);
    if (!info.ready) throw new HubError('PROVIDER_UNAVAILABLE', 503, info.reason ?? 'Provider is not ready');
    const hit = this.models.get(provider);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
    const value = adapter.models();
    this.models.set(provider, { at: Date.now(), value });
    value.catch(() => this.models.delete(provider));
    try { return await value; }
    catch (error) { throw new HubError('PROVIDER_UNAVAILABLE', 503, providerErrorMessage(error, info.displayName)); }
  }
}

type Active = { adapter: AdapterSession; runId: string; unsubscribe: () => void; finished: boolean; cancelRequested: boolean };
export type SessionListener = (event: AgentEvent) => void;
export type DeltaListener = (delta: StreamDelta) => void;

export class SessionManager {
  private active = new Map<string, Active>();
  private starting = new Set<string>();
  private draining = new Set<string>();
  private closing = false;
  private bus = new EventEmitter();
  /** `worktreeRoot`: where isolated session worktrees are created. */
  constructor(readonly store: Store, readonly registry: AgentRegistry, private readonly options: { worktreeRoot?: string } = {}) { this.bus.setMaxListeners(0); }
  /** The directory a session's agent works in: its worktree, or the project checkout. */
  cwdOf(session: Session, project: Project): string { return session.worktree?.path ?? project.path; }
  subscribe(sessionId: string, listener: SessionListener): () => void {
    this.bus.on(sessionId, listener);
    return () => this.bus.off(sessionId, listener);
  }
  /** Ephemeral deltas for one session. */
  subscribeDeltas(sessionId: string, listener: DeltaListener): () => void {
    this.bus.on(`${sessionId}:delta`, listener);
    return () => this.bus.off(`${sessionId}:delta`, listener);
  }
  /** Every persisted event of every session, e.g. for the control-plane connector. */
  subscribeAll(listener: SessionListener): () => void {
    this.bus.on('*', listener);
    return () => this.bus.off('*', listener);
  }
  isActive(sessionId: string): boolean { return this.active.has(sessionId) || this.starting.has(sessionId); }
  approvalPolicy(): ApprovalPolicy {
    const raw = this.store.secret('settings:approvalPolicy');
    if (raw) {
      try { return ApprovalPolicySchema.parse(JSON.parse(raw)); } catch { /* Fall through to defaults. */ }
    }
    // Earlier versions had one "approve everything" switch. It now maps to the
    // trusted policy, which still asks for anything that isn't low risk.
    if (this.store.secret('settings:autoApprove') === 'true') return { mode: 'trusted', autoApproveFileEdits: true, trustedCommands: [] };
    return DEFAULT_APPROVAL_POLICY;
  }
  setApprovalPolicy(policy: ApprovalPolicy): ApprovalPolicy {
    const next = ApprovalPolicySchema.parse(policy);
    this.store.setSecret('settings:approvalPolicy', JSON.stringify(next));
    return next;
  }
  /** Compatibility view of the policy for older clients. */
  autoApprove(): boolean { return this.approvalPolicy().mode === 'trusted'; }
  setAutoApprove(enabled: boolean): boolean { this.setApprovalPolicy({ ...this.approvalPolicy(), mode: enabled ? 'trusted' : 'ask' }); return enabled; }
  async sendOrQueue(sessionId: string, text: string) {
    const session = this.store.session(sessionId);
    if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
    if (this.isActive(sessionId) || session.status === 'running' || session.status === 'awaiting_approval' || this.store.queuedMessages(sessionId).length) {
      const queued = this.store.enqueueMessage(sessionId, text);
      if (!this.isActive(sessionId)) void this.drainQueue(sessionId);
      return { queued };
    }
    try { return await this.send(sessionId, text); }
    catch (error) {
      if (!(error instanceof HubError) || error.code !== 'CONFLICT') throw error;
      return { queued: this.store.enqueueMessage(sessionId, text) };
    }
  }
  private async drainQueue(sessionId: string): Promise<void> {
    if (this.closing || this.draining.has(sessionId) || this.isActive(sessionId)) return;
    const next = this.store.queuedMessages(sessionId)[0];
    if (!next) return;
    this.draining.add(sessionId);
    let started = false;
    try {
      await this.send(sessionId, next.text);
      this.store.deleteQueuedMessage(sessionId, next.id);
      started = true;
    } catch {
      // Keep the message queued and retry when the provider becomes available.
      if (!this.closing) setTimeout(() => { void this.drainQueue(sessionId); }, 10_000).unref?.();
    }
    finally { this.draining.delete(sessionId); }
    if (started && !this.isActive(sessionId)) void this.drainQueue(sessionId);
  }
  resumeQueues(): void { for (const sessionId of this.store.queuedSessions()) void this.drainQueue(sessionId); }
  async create(projectId: string, config: AgentConfig, isolation: 'none' | 'worktree' = 'none'): Promise<Session> {
    const project = this.store.project(projectId);
    if (!project) throw new HubError('NOT_FOUND', 404, 'Project not found');
    const adapter = this.registry.get(config.provider);
    if (projectId === MODEL_CHAT_PROJECT_ID && config.provider !== 'openai' && config.provider !== 'anthropic') throw new HubError('VALIDATION_ERROR', 400, 'Coding agents require a Git repository');
    const info = await this.registry.readiness(config.provider);
    if (!info.ready || !adapter.capabilities.execution) throw new HubError('PROVIDER_UNAVAILABLE', 503, info.reason ?? 'Provider is not ready');
    const now = new Date().toISOString();
    const id = randomUUID();
    let worktree: Worktree | null = null;
    if (isolation === 'worktree') {
      if (projectId === MODEL_CHAT_PROJECT_ID || !this.options.worktreeRoot) throw new HubError('UNSUPPORTED_ACTION', 422, 'Worktrees are available for coding agents in a repository');
      try { worktree = await createWorktree(project.path, join(this.options.worktreeRoot, id), `agentic/${config.provider}-${id.slice(0, 8)}`); }
      catch (error) { throw new HubError('CONFLICT', 409, `Could not create a worktree: ${error instanceof Error ? error.message.split('\n')[0] : 'git failed'}`); }
    }
    const session: Session = { id, projectId, config, status: 'idle', providerSessionId: null, worktree, createdAt: now, updatedAt: now };
    this.store.saveSession(session);
    return session;
  }
  async send(sessionId: string, text: string): Promise<{ task: Task; run: TaskRun }> {
    const session = this.store.session(sessionId);
    if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
    if (this.starting.has(sessionId) || this.active.has(sessionId) || session.status === 'running' || session.status === 'awaiting_approval') throw new HubError('CONFLICT', 409, 'Session already has an active turn');
    this.starting.add(sessionId);
    try {
      const project = this.store.project(session.projectId);
      if (!project) throw new HubError('NOT_FOUND', 404, 'Project not found');
      const adapter = this.registry.get(session.config.provider);
      const info = await this.registry.readiness(session.config.provider);
      if (!info.ready) throw new HubError('PROVIDER_UNAVAILABLE', 503, info.reason ?? 'Provider is not ready');
      let instance: AdapterSession;
      try {
        instance = await adapter.start({ cwd: this.cwdOf(session, project), config: session.config, providerSessionId: session.providerSessionId, history: this.store.transcript(sessionId) });
      } catch (error) {
        if (error instanceof HubError) throw error;
        throw new HubError('PROVIDER_UNAVAILABLE', 503, providerErrorMessage(error, info.displayName));
      }
      const now = new Date().toISOString();
      const task: Task = { id: randomUUID(), sessionId, prompt: redactStoredText(text), createdAt: now };
      const run: TaskRun = { id: randomUUID(), taskId: task.id, sessionId, status: 'running', startedAt: now, finishedAt: null, error: null };
      this.store.saveTask(task);
      this.store.saveRun(run);
      this.setStatus(sessionId, 'running', instance.providerSessionId);
      const active: Active = { adapter: instance, runId: run.id, unsubscribe: () => {}, finished: false, cancelRequested: false };
      const offEvents = instance.subscribe(event => this.accept(sessionId, active, event));
      const offDeltas = instance.subscribeDeltas?.(delta => {
        if (!active.finished && this.active.get(sessionId) === active) this.bus.emit(`${sessionId}:delta`, { ...delta, sessionId, taskRunId: run.id });
      }) ?? (() => {});
      active.unsubscribe = () => { offEvents(); offDeltas(); };
      this.active.set(sessionId, active);
      this.append(sessionId, run.id, { type: 'message', role: 'user', text });
      void instance.send(text).then(() => this.finish(sessionId, active, active.cancelRequested ? 'cancelled' : 'completed', null)).catch(error => this.finish(sessionId, active, active.cancelRequested ? 'cancelled' : 'failed', active.cancelRequested ? null : providerErrorMessage(error, info.displayName)));
      return { task, run };
    } finally {
      this.starting.delete(sessionId);
    }
  }
  private append(sessionId: string, runId: string, event: NewAgentEvent): AgentEvent {
    const full = this.store.appendEvent(sessionId, runId, event);
    this.bus.emit(sessionId, full);
    this.bus.emit('*', full);
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
    let autoApprove = false;
    if (event.type === 'approval_requested') {
      const session = this.store.session(sessionId);
      const project = session && this.store.project(session.projectId);
      const policy = this.approvalPolicy();
      const assessment = assessApproval(event.approval.toolName, event.approval.description, { trustedCommands: policy.trustedCommands, ...(session && project ? { cwd: this.cwdOf(session, project) } : {}) });
      autoApprove = shouldAutoApprove(policy, event.approval.toolName, assessment);
      event = { ...event, approval: { ...event.approval, sessionId, taskRunId: active.runId, risk: assessment.risk, riskReasons: assessment.reasons, ...(autoApprove ? { autoApproved: true } : {}) } };
      this.store.saveApproval(event.approval);
      this.setStatus(sessionId, 'awaiting_approval', active.adapter.providerSessionId);
      const run = this.store.run(active.runId)!;
      this.store.saveRun({ ...run, status: 'awaiting_approval' });
    }
    this.append(sessionId, active.runId, event);
    if (event.type === 'approval_requested' && autoApprove) {
      const approvalId = event.approval.id;
      queueMicrotask(() => { void this.resolveApproval(approvalId, 'approve').catch(() => {}); });
    }
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
    void this.drainQueue(sessionId);
  }
  async cancel(id: string): Promise<Session> {
    const session = this.store.session(id);
    if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
    if (this.starting.has(id)) throw new HubError('CONFLICT', 409, 'Session is starting; retry cancellation');
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
    this.closing = true;
    await Promise.allSettled([...this.active.entries()].map(async ([id, active]) => {
      active.cancelRequested = true;
      try { await active.adapter.cancel(); } finally { this.finish(id, active, 'cancelled', null); }
    }));
    this.store.close();
  }
}
