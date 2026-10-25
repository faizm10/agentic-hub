import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, AgentProvider, ApprovalDecision, ModelInfo, NewAgentEvent, NewStreamDelta, ProviderInfo } from '@agentic-hub/types';
import { credentialHint, type AdapterSession, type AgentAdapter, type CredentialSource, type StartInput } from '@agentic-hub/agent-core';
import { anthropicReply, CAPABILITIES, DEFAULT_MODELS, DISPLAY, listAnthropicModels, listOpenAIModels, normalizeHistory, openaiReply, type ApiProvider, type ReplyStream, type Turn } from './providers.js';

export * from './providers.js';

export class ApiChatSession implements AdapterSession {
  readonly providerSessionId = null;
  private readonly events = new EventEmitter();
  private abort: AbortController | null = null;
  private history: Turn[];
  constructor(private readonly reply: ReplyStream, private readonly apiKey: string, private readonly model: string, history: Turn[]) {
    this.history = [...history];
  }
  subscribe(listener: (event: NewAgentEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }
  subscribeDeltas(listener: (delta: NewStreamDelta) => void): () => void {
    this.events.on('delta', listener);
    return () => this.events.off('delta', listener);
  }
  async send(text: string): Promise<void> {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.history.push({ role: 'user', text });
    const textStream = randomUUID();
    const reasoningStream = randomUUID();
    let reply = '';
    let reasoning = '';
    const flush = () => {
      if (reasoning.trim()) this.events.emit('event', { type: 'reasoning_summary', text: reasoning.trim() } satisfies NewAgentEvent);
      if (reply.trim()) this.events.emit('event', { type: 'message', role: 'assistant', text: reply } satisfies NewAgentEvent);
    };
    try {
      for await (const part of this.reply({ apiKey: this.apiKey, model: this.model, history: normalizeHistory(this.history), signal })) {
        if (part.kind === 'text') reply += part.delta; else reasoning += part.delta;
        this.events.emit('delta', { streamId: part.kind === 'text' ? textStream : reasoningStream, kind: part.kind, delta: part.delta } satisfies NewStreamDelta);
      }
    } catch (error) {
      // Keep whatever arrived before a cancel or failure.
      flush();
      throw error;
    } finally {
      this.abort = null;
    }
    flush();
    if (!reply.trim()) throw new Error('The model returned an empty reply.');
    this.history.push({ role: 'assistant', text: reply });
  }
  async cancel(): Promise<void> { this.abort?.abort(); }
  async resolveApproval(_id: string, _decision: ApprovalDecision): Promise<void> { throw new Error('Model providers do not request approvals'); }
  async cleanup(): Promise<void> { this.abort?.abort(); }
}

/** Official OpenAI or Anthropic API, using a key held by the runtime. Conversational only: no tools run on this machine. */
export class ApiChatAdapter implements AgentAdapter {
  readonly capabilities = CAPABILITIES;
  constructor(
    readonly provider: ApiProvider & AgentProvider,
    private readonly credentials: CredentialSource,
    private readonly reply: ReplyStream = provider === 'openai' ? openaiReply : anthropicReply,
    private readonly lister: (apiKey: string) => Promise<ModelInfo[]> = provider === 'openai' ? listOpenAIModels : listAnthropicModels,
  ) {}
  async readiness(): Promise<ProviderInfo> {
    const display = DISPLAY[this.provider];
    const credential = this.credentials.get(this.provider);
    return {
      provider: this.provider, displayName: display.name, capabilities: this.capabilities, kind: 'model', authMethod: 'api-key',
      installed: true, authenticated: Boolean(credential), ready: Boolean(credential), defaultModel: DEFAULT_MODELS[this.provider], setupUrl: display.setupUrl,
      credential: credential ? { source: credential.source, hint: credentialHint(credential.apiKey) } : null,
      ...(credential ? {} : { reason: `Add an ${display.name} API key in Settings → Providers, or set ${display.env} for the runtime.` }),
    };
  }
  async models(): Promise<ModelInfo[]> {
    const credential = this.credentials.get(this.provider);
    if (!credential) throw new Error(`${DISPLAY[this.provider].name} has no API key`);
    return this.lister(credential.apiKey);
  }
  /** Checks a key against the provider before it is stored. Throws the provider's error on rejection. */
  async verify(apiKey: string): Promise<void> { await this.lister(apiKey); }
  async start(input: StartInput): Promise<AdapterSession> {
    const credential = this.credentials.get(this.provider);
    if (!credential) throw new Error(`${DISPLAY[this.provider].name} has no API key`);
    return new ApiChatSession(this.reply, credential.apiKey, modelFor(this.provider, input.config), input.history);
  }
}

function modelFor(provider: ApiProvider, config: AgentConfig): string { return config.model ?? DEFAULT_MODELS[provider]; }
