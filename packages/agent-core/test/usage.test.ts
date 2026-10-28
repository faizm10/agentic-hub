import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@agentic-hub/types';
import { aggregateUsage, type UsageEntry } from '../src/usage.js';

type Usage = Extract<AgentEvent, { type: 'usage' }>;
let seq = 0;
const usage = (sessionId: string, at: string, fields: Partial<Usage>): Usage => ({
  id: randomUUID(), sessionId, taskRunId: randomUUID(), sequence: seq++, createdAt: at, type: 'usage', model: 'm',
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null, cumulative: false, ...fields,
});

describe('aggregateUsage', () => {
  it('adds per-reply usage and counts only the increase of cumulative totals', () => {
    const a = randomUUID();
    const b = randomUUID();
    const entries: UsageEntry[] = [
      { provider: 'openai', event: usage(a, '2026-10-27T10:00:00Z', { model: 'gpt-5.5', inputTokens: 100, outputTokens: 50 }) },
      { provider: 'openai', event: usage(a, '2026-10-28T10:00:00Z', { model: 'gpt-5.5', inputTokens: 10, outputTokens: 5 }) },
      { provider: 'claude', event: usage(b, '2026-10-27T11:00:00Z', { model: 'opus', inputTokens: 1000, outputTokens: 200, costUsd: 0.5, cumulative: true }) },
      { provider: 'claude', event: usage(b, '2026-10-28T11:00:00Z', { model: 'opus', inputTokens: 1500, outputTokens: 300, costUsd: 0.8, cumulative: true }) },
    ];
    const report = aggregateUsage(entries, { source: 'test', now: new Date('2026-10-28T12:00:00Z') });
    const openai = report.byModel.find(m => m.provider === 'openai')!;
    const claude = report.byModel.find(m => m.provider === 'claude')!;
    expect(openai).toMatchObject({ inputTokens: 110, outputTokens: 55, costUsd: null, turns: 2, sessions: 1 });
    expect(claude).toMatchObject({ inputTokens: 1500, outputTokens: 300, turns: 2, sessions: 1 });
    expect(claude.costUsd).toBeCloseTo(0.8);
    expect(report.daily.find(d => d.provider === 'claude' && d.date === '2026-10-28')).toMatchObject({ inputTokens: 500, outputTokens: 100 });
  });

  it('treats a smaller cumulative total as a counter reset and filters by days', () => {
    const s = randomUUID();
    const entries: UsageEntry[] = [
      { provider: 'codex', event: usage(s, '2026-09-01T00:00:00Z', { inputTokens: 900, outputTokens: 100, cumulative: true }) },
      { provider: 'codex', event: usage(s, '2026-10-28T00:00:00Z', { inputTokens: 50, outputTokens: 10, cumulative: true }) },
    ];
    const report = aggregateUsage(entries, { source: 'test', days: 30, now: new Date('2026-10-28T12:00:00Z') });
    expect(report.byModel[0]).toMatchObject({ inputTokens: 50, outputTokens: 10, turns: 1 });
  });
});
