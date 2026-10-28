/**
 * Streaming chat and model listing for the official OpenAI and Anthropic
 * APIs. No runtime dependencies beyond the SDKs, so the web control plane
 * can use it server-side as well as the local runtime.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { AgentCapabilities, ModelInfo } from '@agentic-hub/types';

export const DEFAULT_MODELS = { openai: 'gpt-5.5', anthropic: 'claude-opus-5-5' } as const;
export type ApiProvider = keyof typeof DEFAULT_MODELS;

export const CAPABILITIES: AgentCapabilities = {
  execution: true, streaming: true, interactiveMessages: true, approvals: false, cancellation: true, gitDiff: false, modelDiscovery: true, textDeltas: true,
};
export const SYSTEM_PROMPT = 'You are a helpful assistant inside Agentic Hub. Use Markdown, and fence code blocks with a language tag.';
export const DISPLAY: Record<ApiProvider, { name: string; setupUrl: string; env: string }> = {
  openai: { name: 'OpenAI', setupUrl: 'https://platform.openai.com/api-keys', env: 'OPENAI_API_KEY' },
  anthropic: { name: 'Anthropic', setupUrl: 'https://console.anthropic.com/settings/keys', env: 'ANTHROPIC_API_KEY' },
};

export type Turn = { role: 'user' | 'assistant'; text: string };
export interface TokenUsage { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number }
export type ReplyPart = { kind: 'text' | 'reasoning'; delta: string } | { kind: 'usage'; usage: TokenUsage };
/** One streamed reply: yields text and reasoning deltas, then the reply's token usage. */
export type ReplyStream = (input: { apiKey: string; model: string; history: Turn[]; signal: AbortSignal }) => AsyncGenerator<ReplyPart, void>;

/** Chat models reject empty turns and (Anthropic) consecutive same-role turns, so the transcript is normalised first. */
export function normalizeHistory(history: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const turn of history) {
    const text = turn.text.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.role === turn.role) last.text = `${last.text}\n\n${text}`;
    else out.push({ role: turn.role, text });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

export const anthropicReply: ReplyStream = async function* ({ apiKey, model, history, signal }) {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const stream = await client.messages.create({
    model, max_tokens: 16_000, system: SYSTEM_PROMPT, stream: true,
    messages: history.map(turn => ({ role: turn.role, content: turn.text })),
  }, { signal });
  const usage: TokenUsage = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  for await (const event of stream) {
    if (event.type === 'message_start') {
      const u = event.message.usage;
      usage.model = event.message.model || model;
      usage.inputTokens = u.input_tokens ?? 0;
      usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
      usage.outputTokens = u.output_tokens ?? 0;
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') yield { kind: 'text', delta: event.delta.text };
      else if (event.delta.type === 'thinking_delta') yield { kind: 'reasoning', delta: event.delta.thinking };
    } else if (event.type === 'message_delta') {
      // Output tokens here are cumulative for the message.
      if (event.usage?.output_tokens != null) usage.outputTokens = event.usage.output_tokens;
      if (event.delta.stop_reason === 'refusal') throw new Error('Anthropic declined to answer this request.');
    }
  }
  yield { kind: 'usage', usage };
};

export const openaiReply: ReplyStream = async function* ({ apiKey, model, history, signal }) {
  const client = new OpenAI({ apiKey, maxRetries: 2 });
  const stream = await client.responses.create({
    model, instructions: SYSTEM_PROMPT, stream: true, store: false,
    input: history.map(turn => ({ role: turn.role, content: turn.text })),
  }, { signal });
  for await (const event of stream) {
    if (event.type === 'response.completed' && event.response.usage) {
      const u = event.response.usage;
      yield {
        kind: 'usage',
        usage: {
          model: event.response.model || model, inputTokens: Math.max(0, u.input_tokens - (u.input_tokens_details?.cached_tokens ?? 0)), outputTokens: u.output_tokens,
          cacheReadTokens: u.input_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: 0, reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
        },
      };
    } else if (event.type === 'response.output_text.delta') yield { kind: 'text', delta: event.delta };
    else if (event.type === 'response.reasoning_summary_text.delta') yield { kind: 'reasoning', delta: event.delta };
    else if (event.type === 'response.failed') throw new Error(event.response.error?.message ?? 'OpenAI response failed');
    else if (event.type === 'error') throw new Error(event.message || 'OpenAI stream error');
  }
};

const OPENAI_CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_EXCLUDED = /(audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct|codex-mini)/;

export async function listOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const client = new OpenAI({ apiKey, maxRetries: 1 });
  const models: ModelInfo[] = [];
  for await (const model of client.models.list()) {
    if (OPENAI_CHAT_MODEL.test(model.id) && !OPENAI_EXCLUDED.test(model.id)) models.push({ id: model.id, displayName: model.id, isDefault: model.id === DEFAULT_MODELS.openai });
  }
  return models.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.id.localeCompare(a.id));
}

export async function listAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const models: ModelInfo[] = [];
  for await (const model of client.models.list()) {
    models.push({ id: model.id, displayName: model.display_name || model.id, isDefault: model.id === DEFAULT_MODELS.anthropic });
  }
  return models;
}

