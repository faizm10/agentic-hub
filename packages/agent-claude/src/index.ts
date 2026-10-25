import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentCapabilities, AgentConfig, ApprovalDecision, NewAgentEvent, ProviderInfo } from '@agentic-hub/types';
import type { AdapterSession, AgentAdapter } from '@agentic-hub/agent-core';

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
  return events;
}

export class ClaudeSession implements AdapterSession {
  readonly events = new EventEmitter();
  providerSessionId: string | null;
  private abort: AbortController | null = null;
  private approvals = new Map<string, (decision: ApprovalDecision) => void>();
  constructor(private readonly cwd: string, private readonly model: string | undefined, previous: string | null) {
    this.providerSessionId = previous ?? randomUUID();
    this.hasRun = previous !== null;
  }
  subscribe(listener: (event: NewAgentEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }
  private emit(event: NewAgentEvent): void { this.events.emit('event', event); }
  private readonly canUseTool: CanUseTool = async (toolName, _input, options) => {
    const id = randomUUID();
    const description = options.title ?? options.description ?? `${toolName} requires approval`;
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
    for (const event of normalizeClaudeMessage(message)) this.emit(event);
  }
  async send(text: string): Promise<void> {
    this.abort = new AbortController();
    const previous = this.providerSessionId;
    const conversation = query({ prompt: text, options: {
      cwd: this.cwd, abortController: this.abort, canUseTool: this.canUseTool,
      ...(this.model ? { model: this.model } : {}),
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
  readonly capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true };
  async readiness(): Promise<ProviderInfo> {
    try {
      await exec('claude', ['--version'], { timeout: 5_000 });
      const { stdout } = await exec('claude', ['auth', 'status'], { timeout: 5_000 });
      const auth = JSON.parse(stdout) as { loggedIn?: boolean };
      return { provider: this.provider, displayName: 'Claude Code', capabilities: this.capabilities, installed: true, authenticated: auth.loggedIn === true, ready: auth.loggedIn === true, ...(auth.loggedIn ? {} : { reason: 'Claude Code is not signed in' }) };
    } catch { return { provider: this.provider, displayName: 'Claude Code', capabilities: this.capabilities, installed: false, authenticated: false, ready: false, reason: 'Claude Code CLI is unavailable' }; }
  }
  async start(input: { cwd: string; config: AgentConfig; providerSessionId: string | null }): Promise<AdapterSession> {
    return new ClaudeSession(input.cwd, input.config.model, input.providerSessionId);
  }
}
