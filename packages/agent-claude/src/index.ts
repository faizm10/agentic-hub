import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentCapabilities, ApprovalDecision, ModelInfo, NewAgentEvent, NewStreamDelta, ProviderInfo } from '@agentic-hub/types';
import type { AdapterSession, AgentAdapter, StartInput } from '@agentic-hub/agent-core';

const exec = promisify(execFile);

export function normalizeClaudeMessage(message: SDKMessage): NewAgentEvent[] {
  const events: NewAgentEvent[] = [];
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text) events.push({ type: 'message', role: 'assistant', text: block.text });
      if (block.type === 'tool_use') events.push({ type: 'tool_start', toolCallId: block.id, toolName: block.name, description: block.name });
    }
  }
  if (message.type === 'user' && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue;
      const content = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
      events.push({ type: 'tool_result', toolCallId: block.tool_use_id, toolName: 'tool', output: content, success: !block.is_error });
    }
  }
  if (message.type === 'result' && message.modelUsage) {
    // Running totals per model for this session (Claude Code reports cumulative usage and an estimated cost).
    for (const [model, usage] of Object.entries(message.modelUsage)) {
      events.push({
        type: 'usage', model, cumulative: true,
        inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadInputTokens ?? 0, cacheWriteTokens: usage.cacheCreationInputTokens ?? 0,
        reasoningTokens: usage.thinkingTokens ?? 0, costUsd: typeof usage.costUSD === 'number' ? usage.costUSD : null,
      });
    }
  }
  return events;
}

/** Text and thinking deltas from `includePartialMessages` stream events. */
export function claudeDelta(message: SDKMessage): { kind: 'text' | 'reasoning'; delta: string; index: number } | null {
  if (message.type !== 'stream_event' || message.parent_tool_use_id) return null;
  const event = message.event;
  if (event.type !== 'content_block_delta') return null;
  if (event.delta.type === 'text_delta') return { kind: 'text', delta: event.delta.text, index: event.index };
  if (event.delta.type === 'thinking_delta') return { kind: 'reasoning', delta: event.delta.thinking, index: event.index };
  return null;
}

/** Resolves the signed-in `claude` CLI so the SDK drives the user's own installation. */
async function claudeExecutable(): Promise<string | null> {
  if (process.env.AGENTIC_HUB_CLAUDE_BIN) return process.env.AGENTIC_HUB_CLAUDE_BIN;
  try { return (await exec('/usr/bin/which', ['claude'], { timeout: 3_000 })).stdout.trim() || null; } catch { return null; }
}

export function describeClaudeApproval(toolName: string, input: Record<string, unknown>, title?: string, description?: string): string {
  const detail = toolName === 'Bash' && typeof input.command === 'string'
    ? input.command
    : typeof input.file_path === 'string' ? input.file_path
    : typeof input.path === 'string' ? input.path
    : '';
  // The full tool input can include file contents, credentials, and model output.
  return [title || description || `${toolName} requires approval`, detail].filter(Boolean).join(' — ').slice(0, 2_000);
}

export class ClaudeSession implements AdapterSession {
  readonly events = new EventEmitter();
  providerSessionId: string | null;
  private abort: AbortController | null = null;
  private approvals = new Map<string, (decision: ApprovalDecision) => void>();
  constructor(private readonly cwd: string, private readonly model: string | undefined, previous: string | null, private readonly executable: string | null = null) {
    this.providerSessionId = previous ?? randomUUID();
    this.hasRun = previous !== null;
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
  private streamPrefix = randomUUID();
  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    const id = randomUUID();
    const description = describeClaudeApproval(toolName, input, options.title, options.description);
    this.emit({ type: 'approval_requested', approval: { id, sessionId: '', taskRunId: '', toolName, description, status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null } });
    const decision = await new Promise<ApprovalDecision>((resolve) => {
      this.approvals.set(id, resolve);
      options.signal.addEventListener('abort', () => resolve('deny'), { once: true });
    });
    this.approvals.delete(id);
    return decision === 'approve' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by user' };
  };
  private accept(message: SDKMessage): void {
    if ('session_id' in message && message.session_id) this.providerSessionId = message.session_id;
    if (message.type === 'stream_event' && message.event.type === 'message_start') this.streamPrefix = randomUUID();
    const delta = claudeDelta(message);
    if (delta) { this.events.emit('delta', { streamId: `${this.streamPrefix}:${delta.index}`, kind: delta.kind, delta: delta.delta } satisfies NewStreamDelta); return; }
    for (const event of normalizeClaudeMessage(message)) this.emit(event);
  }
  async send(text: string): Promise<void> {
    this.abort = new AbortController();
    const previous = this.providerSessionId;
    const conversation = query({ prompt: text, options: {
      cwd: this.cwd, abortController: this.abort, canUseTool: this.canUseTool, includePartialMessages: true,
      // The runtime records and resolves approvals; the SDK itself keeps its normal permission mode.
      permissionMode: 'default',
      ...(this.executable ? { pathToClaudeCodeExecutable: this.executable } : {}),
      ...(this.model && this.model !== 'default' ? { model: this.model } : {}),
      ...(previous && this.hasRun ? { resume: previous } : { sessionId: previous! }),
    } });
    this.hasRun = true;
    let sawSuccess = false;
    try {
      for await (const message of conversation) {
        this.accept(message);
        if (message.type === 'result') {
          if (message.subtype !== 'success' || message.is_error) throw new Error(message.subtype === 'success' ? 'Claude reported an error' : message.errors.join('; ') || message.subtype);
          sawSuccess = true;
        }
      }
      if (!sawSuccess) throw new Error('Claude ended without a result');
    } finally { this.abort = null; }
  }
  private hasRun = false;
  async cancel(): Promise<void> {
    this.abort?.abort();
    for (const resolve of this.approvals.values()) resolve('deny');
    this.approvals.clear();
  }
  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    const resolve = this.approvals.get(id);
    if (!resolve) throw new Error('Approval is not pending');
    resolve(decision);
    this.approvals.delete(id);
  }
  async cleanup(): Promise<void> { await this.cancel(); }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly provider = 'claude';
  readonly capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true, modelDiscovery: true, textDeltas: true };
  async readiness(): Promise<ProviderInfo> {
    const base = { provider: this.provider, displayName: 'Claude Code', capabilities: this.capabilities, kind: 'agent', authMethod: 'cli', setupUrl: 'https://code.claude.com/docs/en/setup' } as const;
    const bin = await claudeExecutable();
    let version: string;
    try {
      if (!bin) throw new Error('missing');
      version = (await exec(bin, ['--version'], { timeout: 5_000 })).stdout.trim();
    } catch { return { ...base, installed: false, authenticated: false, ready: false, reason: 'Claude Code CLI is not installed. Install it, then run `claude` to sign in.' }; }
    try {
      const { stdout } = await exec(bin!, ['auth', 'status'], { timeout: 5_000 }).catch(error => ({ stdout: String(error.stdout ?? '') }));
      const auth = JSON.parse(stdout) as { loggedIn?: boolean };
      return { ...base, version, installed: true, authenticated: auth.loggedIn === true, ready: auth.loggedIn === true, ...(auth.loggedIn ? {} : { reason: 'Claude Code is not signed in. Run `claude` in a terminal and sign in.' }) };
    } catch { return { ...base, version, installed: true, authenticated: false, ready: false, reason: 'Claude Code authentication could not be verified. Run `claude auth status`.' }; }
  }
  async models(): Promise<ModelInfo[]> {
    const abort = new AbortController();
    const bin = await claudeExecutable();
    // An input stream that never yields: the session initialises without sending a prompt.
    const idle = (async function* () { await new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('closed')), { once: true })); })();
    const conversation = query({ prompt: idle as AsyncIterable<never>, options: { abortController: abort, ...(bin ? { pathToClaudeCodeExecutable: bin } : {}) } });
    try {
      const models = await conversation.supportedModels();
      return models.map(model => ({ id: model.value, displayName: model.displayName, ...(model.description ? { description: model.description } : {}), isDefault: model.value === 'default' }));
    } finally {
      abort.abort();
    }
  }
  async start(input: StartInput): Promise<AdapterSession> {
    return new ClaudeSession(input.cwd, input.config.model, input.providerSessionId, await claudeExecutable());
  }
}
