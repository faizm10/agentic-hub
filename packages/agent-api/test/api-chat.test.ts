import { describe, expect, it } from 'vitest';
import type { NewAgentEvent, NewStreamDelta } from '@agentic-hub/types';
import { ApiChatAdapter, normalizeHistory, type ReplyStream } from '../src/index.js';

const credentials = (apiKey: string | null) => ({ get: () => (apiKey ? { apiKey, source: 'stored' as const } : null) });

describe('normalizeHistory', () => {
  it('merges consecutive turns, drops blanks and leading assistant turns', () => {
    expect(normalizeHistory([
      { role: 'assistant', text: 'hello' },
      { role: 'user', text: 'one' },
      { role: 'user', text: '  ' },
      { role: 'user', text: 'two' },
      { role: 'assistant', text: 'reply' },
    ])).toEqual([{ role: 'user', text: 'one\n\ntwo' }, { role: 'assistant', text: 'reply' }]);
  });
});

describe('ApiChatAdapter', () => {
  it('reports missing keys without exposing anything', async () => {
    const info = await new ApiChatAdapter('openai', credentials(null)).readiness();
    expect(info).toMatchObject({ ready: false, kind: 'model', authMethod: 'api-key', credential: null });
    expect(info.reason).toContain('OPENAI_API_KEY');
  });

  it('shows only a key hint when configured', async () => {
    const info = await new ApiChatAdapter('anthropic', credentials(`sk-ant-${'x'.repeat(30)}wxyz`)).readiness();
    expect(info.ready).toBe(true);
    expect(info.credential).toEqual({ source: 'stored', hint: 'sk-ant-…wxyz' });
    expect(JSON.stringify(info)).not.toContain('xxxxxxxx');
  });

  it('streams deltas, then emits the complete reply with the full history', async () => {
    let seenHistory: unknown;
    const reply: ReplyStream = async function* ({ history }) {
      seenHistory = history;
      yield { kind: 'reasoning', delta: 'Thinking' };
      yield { kind: 'text', delta: 'Hel' };
      yield { kind: 'text', delta: 'lo' };
    };
    const adapter = new ApiChatAdapter('openai', credentials('sk-test-key-123456'), reply, async () => []);
    const session = await adapter.start({ cwd: '/', config: { provider: 'openai', model: 'gpt-test' }, providerSessionId: null, history: [{ role: 'user', text: 'earlier' }, { role: 'assistant', text: 'answer' }] });
    const events: NewAgentEvent[] = [];
    const deltas: NewStreamDelta[] = [];
    session.subscribe(event => events.push(event));
    session.subscribeDeltas!(delta => deltas.push(delta));
    await session.send('now');
    expect(seenHistory).toEqual([{ role: 'user', text: 'earlier' }, { role: 'assistant', text: 'answer' }, { role: 'user', text: 'now' }]);
    expect(deltas.map(d => d.delta)).toEqual(['Thinking', 'Hel', 'lo']);
    expect(new Set(deltas.filter(d => d.kind === 'text').map(d => d.streamId)).size).toBe(1);
    expect(events).toEqual([{ type: 'reasoning_summary', text: 'Thinking' }, { type: 'message', role: 'assistant', text: 'Hello' }]);
  });

  it('cancels an in-flight reply through the abort signal and keeps partial text', async () => {
    const reply: ReplyStream = async function* ({ signal }) {
      yield { kind: 'text', delta: 'partial' };
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const session = await new ApiChatAdapter('anthropic', credentials('sk-ant-test-123456'), reply, async () => []).start({ cwd: '/', config: { provider: 'anthropic' }, providerSessionId: null, history: [] });
    const events: NewAgentEvent[] = [];
    session.subscribe(event => events.push(event));
    const sending = session.send('hi');
    await new Promise(resolve => setTimeout(resolve, 5));
    await session.cancel();
    await expect(sending).rejects.toThrow('aborted');
    expect(events).toEqual([{ type: 'message', role: 'assistant', text: 'partial' }]);
  });
});
