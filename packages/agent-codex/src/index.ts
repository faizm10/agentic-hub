import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { AgentCapabilities, ApprovalDecision, ModelInfo, NewAgentEvent, NewStreamDelta, ProviderInfo } from '@agentic-hub/types';
import type { AgentAdapter, AdapterSession, StartInput } from '@agentic-hub/agent-core';

const exec = promisify(execFile);
type RecordValue = Record<string, unknown>;
const obj = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const str = (value: unknown): string => typeof value === 'string' ? value : '';

export function normalizeCodexItem(raw: unknown, phase: 'started' | 'completed'): NewAgentEvent[] {
  const item = obj(raw);
  const id = str(item.id);
  const type = str(item.type);
  const name = type === 'commandExecution' ? 'commandExecution' : type === 'mcpToolCall' ? str(item.tool) : type;
  if (phase === 'started') {
    return ['commandExecution', 'mcpToolCall', 'fileChange'].includes(type)
      ? [{ type: 'tool_start', toolCallId: id, toolName: name, description: str(item.command) || name }]
      : [];
  }
  const events: NewAgentEvent[] = [];
  if (type === 'agentMessage' && str(item.text)) events.push({ type: 'message', role: 'assistant', text: str(item.text) });
  if (type === 'reasoning' && Array.isArray(item.summary)) {
    const summary = item.summary.map(part => str(obj(part).text)).filter(Boolean).join('\n');
    if (summary) events.push({ type: 'reasoning_summary', text: summary });
  }
  if (['commandExecution', 'mcpToolCall', 'fileChange'].includes(type)) {
    events.push({ type: 'tool_result', toolCallId: id, toolName: name, output: str(item.aggregatedOutput) || str(item.error), success: str(item.status) === 'completed' });
  }
  if (type === 'fileChange' && Array.isArray(item.changes)) {
    for (const change of item.changes) {
      const data = obj(change);
      const kind = str(data.kind);
      const normalized = kind === 'add' ? 'added' : kind === 'delete' ? 'deleted' : 'modified';
      if (str(data.path)) events.push({ type: 'file_changed', path: str(data.path), change: normalized });
    }
  }
  return events;
}

const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** Thread totals (`TokenUsageBreakdown`) as a cumulative usage event. Input excludes cached tokens. */
export function codexUsage(total: RecordValue, model: string | undefined): NewAgentEvent {
  const cached = num(total.cachedInputTokens);
  return {
    type: 'usage', model: model ?? 'default', cumulative: true, costUsd: null,
    inputTokens: Math.max(0, num(total.inputTokens) - cached), outputTokens: num(total.outputTokens),
    cacheReadTokens: cached, cacheWriteTokens: num(total.cacheWriteInputTokens), reasoningTokens: num(total.reasoningOutputTokens),
  };
}

/** `item/agentMessage/delta` and `item/reasoning/summaryTextDelta` notifications as hub deltas. */
export function codexDelta(method: string, params: RecordValue): NewStreamDelta | null {
  const delta = str(params.delta);
  if (!delta) return null;
  if (method === 'item/agentMessage/delta') return { streamId: str(params.itemId), kind: 'text', delta };
  if (method === 'item/reasoning/summaryTextDelta') return { streamId: `${str(params.itemId)}:${String(params.summaryIndex ?? 0)}`, kind: 'reasoning', delta };
  return null;
}

class CodexSession implements AdapterSession {
  readonly events = new EventEmitter();
  readonly process = spawn('codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'] });
  providerSessionId: string | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: RecordValue): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private approvals = new Map<string, string | number>();
  private turnId: string | null = null;
  /** Latest thread-wide token totals from `thread/tokenUsage/updated`. */
  private tokenTotal: RecordValue | null = null;
  private turnDone: { resolve(): void; reject(error: Error): void } | null = null;
  private closed = false;
  constructor(private readonly cwd: string, private readonly model: string | undefined) {
    createInterface({ input: this.process.stdout }).on('line', line => {
      try { this.onMessage(obj(JSON.parse(line))); } catch { /* malformed provider output is ignored */ }
    });
    this.process.on('close', () => {
      this.closed = true;
      for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('Codex app-server closed')); }
      this.pending.clear();
      this.turnDone?.reject(new Error('Codex app-server closed'));
      this.turnDone = null;
    });
    this.process.on('error', error => {
      for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
      this.pending.clear();
      this.turnDone?.reject(error);
      this.turnDone = null;
    });
  }
  private write(value: RecordValue): void {
    if (this.closed || !this.process.stdin.writable) throw new Error('Codex app-server is unavailable');
    this.process.stdin.write(`${JSON.stringify(value)}\n`);
  }
  private request(method: string, params: RecordValue): Promise<RecordValue> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async handshake(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'agentic_hub', title: 'Agentic Hub', version: '0.2.0' } });
    this.write({ method: 'initialized', params: {} });
  }
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.request('model/list', cursor ? { cursor } : {});
      for (const raw of Array.isArray(page.data) ? page.data : []) {
        const model = obj(raw);
        if (model.hidden === true || !str(model.model)) continue;
        models.push({ id: str(model.model), displayName: str(model.displayName) || str(model.model), ...(str(model.description) ? { description: str(model.description) } : {}), isDefault: model.isDefault === true });
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
    } while (cursor);
    return models;
  }
  async initialize(previous: string | null): Promise<void> {
    await this.handshake();
    const result = previous
      ? await this.request('thread/resume', { threadId: previous, excludeTurns: true })
      : await this.request('thread/start', { cwd: this.cwd, ...(this.model ? { model: this.model } : {}) });
    this.providerSessionId = str(obj(result.thread).id);
    if (!this.providerSessionId) throw new Error('Codex did not return a thread ID');
  }
  subscribe(listener: (event: NewAgentEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }
  subscribeDeltas(listener: (delta: NewStreamDelta) => void): () => void {
    this.events.on('delta', listener);
    return () => this.events.off('delta', listener);
  }
  private emit(event: NewAgentEvent): void { this.events.emit('event', event); }
  private onMessage(message: RecordValue): void {
    if (typeof message.id === 'number' && !message.method) {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(str(obj(message.error).message) || 'Codex request failed'));
      else call.resolve(obj(message.result));
      return;
    }
    const method = str(message.method);
    const params = obj(message.params);
    if ((typeof message.id === 'number' || typeof message.id === 'string') && (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval')) {
      if (str(params.threadId) !== this.providerSessionId || (this.turnId && str(params.turnId) !== this.turnId)) {
        this.write({ id: message.id, error: { code: -32602, message: 'Approval does not belong to the active turn' } });
        return;
      }
      const id = randomUUID();
      this.approvals.set(id, message.id);
      const toolName = method.includes('commandExecution') ? 'commandExecution' : 'fileChange';
      const description = str(params.reason) || str(params.command) || `${toolName} requires approval`;
      this.emit({ type: 'approval_requested', approval: { id, sessionId: '', taskRunId: '', toolName, description, status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null } });
      return;
    }
    if ((typeof message.id === 'number' || typeof message.id === 'string') && method) {
      this.write({ id: message.id, error: { code: -32601, message: 'Agentic Hub does not support this provider request' } });
      return;
    }
    if (method === 'thread/tokenUsage/updated' && str(params.threadId) === this.providerSessionId) {
      this.tokenTotal = obj(obj(params.tokenUsage).total);
      return;
    }
    if (method === 'turn/completed' && str(params.threadId) === this.providerSessionId) {
      const turn = obj(params.turn);
      if (this.turnId && str(turn.id) !== this.turnId) return;
      if (this.tokenTotal) this.emit(codexUsage(this.tokenTotal, this.model));
      const done = this.turnDone;
      this.turnDone = null;
      this.turnId = null;
      if (str(turn.status) === 'completed') done?.resolve();
      else done?.reject(new Error(str(obj(turn.error).message) || `Codex turn ${str(turn.status)}`));
      return;
    }
    if (str(params.threadId) !== this.providerSessionId) return;
    const delta = codexDelta(method, params);
    if (delta) { this.events.emit('delta', delta); return; }
    if (method === 'error') { this.emit({ type: 'error', code: 'CODEX_ERROR', message: str(obj(params.error).message) || 'Codex error' }); return; }
    if (method !== 'item/started' && method !== 'item/completed') return;
    for (const event of normalizeCodexItem(params.item, method === 'item/started' ? 'started' : 'completed')) this.emit(event);
  }
  async send(text: string): Promise<void> {
    if (!this.providerSessionId) throw new Error('Codex session not initialized');
    const completed = new Promise<void>((resolve, reject) => { this.turnDone = { resolve, reject }; });
    try {
      const result = await this.request('turn/start', { threadId: this.providerSessionId, input: [{ type: 'text', text }] });
      this.turnId = str(obj(result.turn).id);
      if (!this.turnId) throw new Error('Codex did not return a turn ID');
      await completed;
    } finally { this.turnDone = null; }
  }
  async cancel(): Promise<void> {
    if (this.turnId && this.providerSessionId) await this.request('turn/interrupt', { threadId: this.providerSessionId, turnId: this.turnId });
  }
  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    const requestId = this.approvals.get(id);
    if (requestId === undefined) throw new Error('Approval is not pending');
    this.write({ id: requestId, result: { decision: decision === 'approve' ? 'accept' : 'decline' } });
    this.approvals.delete(id);
  }
  async cleanup(): Promise<void> { this.process.kill(); }
}

export class CodexAdapter implements AgentAdapter {
  readonly provider = 'codex';
  readonly capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true, modelDiscovery: true, textDeltas: true };
  async readiness(): Promise<ProviderInfo> {
    const base = { provider: this.provider, displayName: 'Codex', capabilities: this.capabilities, kind: 'agent', authMethod: 'cli', setupUrl: 'https://developers.openai.com/codex/cli' } as const;
    try {
      const version = (await exec('codex', ['--version'], { timeout: 5_000 })).stdout.trim();
      const auth = await exec('codex', ['login', 'status'], { timeout: 5_000 }).then(() => true).catch(() => false);
      return { ...base, version, installed: true, authenticated: auth, ready: auth, ...(auth ? {} : { reason: 'Codex is not signed in. Run `codex login` in a terminal.' }) };
    } catch { return { ...base, installed: false, authenticated: false, ready: false, reason: 'Codex CLI is not installed. Install it with `npm install -g @openai/codex`.' }; }
  }
  async models(): Promise<ModelInfo[]> {
    const session = new CodexSession(process.cwd(), undefined);
    try { await session.handshake(); return await session.listModels(); }
    finally { await session.cleanup(); }
  }
  async start(input: StartInput): Promise<AdapterSession> {
    const session = new CodexSession(input.cwd, input.config.model);
    try { await session.initialize(input.providerSessionId); return session; }
    catch (error) { await session.cleanup(); throw error; }
  }
}
