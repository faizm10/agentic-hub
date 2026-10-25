import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { MuseClient, readSessionDurability, spawnMspConnection, type ApprovalHandler, type FoldedItem, type Session, type SpawnedMspConnection } from '@muse-code/sdk';
import type { AgentCapabilities, ApprovalDecision, ModelInfo, NewAgentEvent, NewStreamDelta, ProviderInfo } from '@agentic-hub/types';
import type { AdapterSession, AgentAdapter, StartInput } from '@agentic-hub/agent-core';

const exec = promisify(execFile);
const CLIENT_INFO = { name: 'agentic_hub', version: '0.2.0' };
const SETUP_URL = 'https://dev.meta.ai/docs/muse-code';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'rejected', 'timedOut']);

type Approval = { request: Parameters<ApprovalHandler>[0]; resolve: (decision: ApprovalDecision) => void };

/** Picks the server-offered choice for a decision. Choice ids are opaque, so match on `decision`, preferring one-time grants. */
export function choiceFor(request: Parameters<ApprovalHandler>[0], decision: ApprovalDecision): string | null {
  const wanted = decision === 'approve' ? ['approved'] : ['denied', 'abort'];
  const candidates = request.availableChoices.filter(choice => wanted.includes(String(choice.decision)));
  return (candidates.find(choice => choice.scope === 'once') ?? candidates[0])?.choiceId ?? null;
}

export function describeMuseApproval(request: Parameters<ApprovalHandler>[0]): string {
  const subject = request.subject;
  const detail = subject.command ?? subject.host ?? ('path' in subject && typeof subject.path === 'string' ? subject.path : '') ?? '';
  return [`${request.toolName} requires approval`, detail].filter(Boolean).join(' — ').slice(0, 2_000);
}

/** Maps one folded Muse item to hub events. `seen` tracks which items already produced a start and a terminal event. */
export function normalizeMuseItem(item: FoldedItem, seen: Map<string, 'started' | 'done'>): NewAgentEvent[] {
  const state = seen.get(item.itemId);
  if (state === 'done') return [];
  const terminal = TERMINAL.has(String(item.status));
  const events: NewAgentEvent[] = [];
  if (item.kind === 'toolCall') {
    const name = item.tool ?? item.displayLabel?.done ?? 'tool';
    if (!state) events.push({ type: 'tool_start', toolCallId: item.itemId, toolName: name, description: item.displayLabel?.active ?? item.args?.slice(0, 500) ?? name });
    if (terminal) events.push({ type: 'tool_result', toolCallId: item.itemId, toolName: name, output: item.visibleOutput ?? item.failureReason ?? '', success: item.status === 'completed' });
  } else if (terminal && item.kind === 'agentMessage' && item.text) {
    events.push({ type: 'message', role: 'assistant', text: item.text });
  } else if (terminal && item.kind === 'reasoning' && item.summary?.length) {
    events.push({ type: 'reasoning_summary', text: item.summary.join('\n') });
  }
  if (terminal) seen.set(item.itemId, 'done');
  else if (!state && item.kind === 'toolCall') seen.set(item.itemId, 'started');
  return events;
}

async function spawnHost(cwd: string, museBin: string): Promise<SpawnedMspConnection> {
  const handshake = spawnMspConnection({ command: museBin, args: ['serve'], cwd, env: process.env });
  return handshake.initialize({ clientInfo: CLIENT_INFO });
}

export class MuseSession implements AdapterSession {
  providerSessionId: string | null;
  private readonly events = new EventEmitter();
  private readonly approvals = new Map<string, Approval>();
  private turnId: string | null = null;
  private constructor(private readonly host: SpawnedMspConnection, private readonly client: MuseClient, private readonly session: Session) {
    this.providerSessionId = session.sessionId;
  }
  static async open(input: StartInput, museBin: string): Promise<MuseSession> {
    const host = await spawnHost(input.cwd, museBin);
    const client = new MuseClient(host.connection, { durability: readSessionDurability(host.initializeResult), host });
    let self: MuseSession | null = null;
    const onApproval: ApprovalHandler = request => self!.requestApproval(request);
    try {
      const session = input.providerSessionId
        ? await client.resumeSession({ sessionId: input.providerSessionId, onApproval, onApprovalError: failure => self?.emit({ type: 'error', code: 'MUSE_APPROVAL', message: `Approval could not be submitted (${failure.kind}).` }) })
        : await client.startSession({ workspaceRoot: input.cwd, ...(input.config.model ? { modelId: input.config.model } : {}) });
      self = new MuseSession(host, client, session);
      if (!input.providerSessionId) session.onApproval(onApproval);
      return self;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }
  private emit(event: NewAgentEvent): void { this.events.emit('event', event); }
  subscribe(listener: (event: NewAgentEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }
  subscribeDeltas(listener: (delta: NewStreamDelta) => void): () => void {
    this.events.on('delta', listener);
    return () => this.events.off('delta', listener);
  }
  private async requestApproval(request: Parameters<ApprovalHandler>[0]) {
    const id = randomUUID();
    const decision = await new Promise<ApprovalDecision>(resolve => {
      this.approvals.set(id, { request, resolve });
      this.emit({ type: 'approval_requested', approval: { id, sessionId: '', taskRunId: '', toolName: request.toolName, description: describeMuseApproval(request), status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null } });
    });
    this.approvals.delete(id);
    const choiceId = choiceFor(request, decision) ?? choiceFor(request, 'deny');
    if (!choiceId) throw new Error('Muse offered no matching choice');
    return { choiceId };
  }
  async send(text: string): Promise<void> {
    const turn = await this.session.sendUserTurn({ input: [{ type: 'text', text }] });
    this.turnId = turn.turnId;
    const seen = new Map<string, 'started' | 'done'>();
    const items = (async () => {
      for await (const item of turn.items()) for (const event of normalizeMuseItem(item, seen)) this.emit(event);
    })();
    const deltas = (async () => {
      for await (const delta of turn.deltas()) {
        const kind = !delta.field || delta.field === 'text' ? 'text' : delta.field.startsWith('summary') ? 'reasoning' : null;
        if (kind) this.events.emit('delta', { streamId: delta.itemId, kind, delta: delta.delta } satisfies NewStreamDelta);
      }
    })();
    try {
      const outcome = await turn.completed;
      await Promise.allSettled([items, deltas]);
      if (outcome.kind === 'unqueued') throw new Error('Muse withdrew the queued turn.');
      if (outcome.kind === 'terminalUnknown') throw new Error('The Muse host exited before the turn finished.');
      if (outcome.params.terminal === 'failed') throw new Error(outcome.params.error?.message ?? outcome.params.reason ?? 'Muse turn failed');
      if (outcome.params.terminal === 'cancelled') throw new Error('Muse turn was cancelled');
    } finally {
      this.turnId = null;
    }
  }
  async cancel(): Promise<void> {
    for (const approval of this.approvals.values()) approval.resolve('deny');
    if (this.turnId) await this.host.connection.command('turn/interrupt', { sessionId: this.session.sessionId, turnId: this.turnId });
  }
  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error('Approval is not pending');
    if (!choiceFor(approval.request, decision)) throw new Error('Muse did not offer that decision');
    approval.resolve(decision);
  }
  async cleanup(): Promise<void> {
    for (const approval of this.approvals.values()) approval.resolve('deny');
    await this.client.close().catch(() => {});
  }
}

/** Meta's Muse Code agent over the official SDK and `muse serve` (Muse Session Protocol). */
export class MuseAdapter implements AgentAdapter {
  readonly provider = 'muse';
  readonly capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true, modelDiscovery: true, textDeltas: true };
  constructor(private readonly museBin = process.env.AGENTIC_HUB_MUSE_BIN ?? 'muse') {}
  async readiness(): Promise<ProviderInfo> {
    const base = { provider: this.provider, displayName: 'Muse Code', capabilities: this.capabilities, kind: 'agent', authMethod: 'cli', setupUrl: SETUP_URL } as const;
    let version: string;
    try { version = (await exec(this.museBin, ['--version'], { timeout: 5_000 })).stdout.trim(); }
    catch { return { ...base, installed: false, authenticated: false, ready: false, reason: 'Muse Code CLI is not installed. Install it with `curl -fsSL https://dev.meta.ai/install.sh | sh`.' }; }
    // Muse has no documented auth-status command. An exported key is authoritative; otherwise `muse usage` needs a valid sign-in.
    const authenticated = Boolean(process.env.META_API_KEY) || await exec(this.museBin, ['usage'], { timeout: 10_000 }).then(() => true, () => false);
    return { ...base, version, installed: true, authenticated, ready: authenticated, ...(authenticated ? {} : { reason: 'Muse Code is not signed in. Run `muse` and sign in, or set META_API_KEY for the runtime.' }) };
  }
  async models(): Promise<ModelInfo[]> {
    const host = await spawnHost(process.cwd(), this.museBin);
    try {
      const result = await host.connection.request('model/list', {}) as { models?: { modelId: string; displayLabel: string; description: string | null; isDefault: boolean }[] };
      return (result.models ?? []).map(model => ({ id: model.modelId, displayName: model.displayLabel || model.modelId, ...(model.description ? { description: model.description } : {}), isDefault: model.isDefault }));
    } finally {
      await host.close().catch(() => {});
    }
  }
  start(input: StartInput): Promise<AdapterSession> { return MuseSession.open(input, this.museBin); }
}
