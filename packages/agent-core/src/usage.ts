import type { AgentEvent, AgentProvider, UsageReport, UsageTotals } from '@agentic-hub/types';

type UsageEvent = Extract<AgentEvent, { type: 'usage' }>;
export interface UsageEntry { provider: AgentProvider; event: UsageEvent }

const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const;
const empty = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null, turns: 0 });

function add(into: UsageTotals, delta: Omit<UsageTotals, 'turns'>) {
  for (const field of FIELDS) into[field] += delta[field];
  if (delta.costUsd !== null) into.costUsd = (into.costUsd ?? 0) + delta.costUsd;
  into.turns += 1;
}

/**
 * Folds usage events into per-model totals and UTC daily buckets.
 *
 * Per-reply events add up directly. Cumulative events (running session totals
 * from Claude Code and Codex) contribute only their increase over the previous
 * total for the same session and model; a smaller value means the provider
 * reset its counter, so it counts in full.
 */
export function aggregateUsage(entries: UsageEntry[], options: { source: string; days?: number; now?: Date }): UsageReport {
  const now = options.now ?? new Date();
  const since = options.days ? new Date(now.getTime() - options.days * 86_400_000).toISOString().slice(0, 10) : null;
  const byModel = new Map<string, UsageReport['byModel'][number] & { sessionIds: Set<string> }>();
  const daily = new Map<string, UsageReport['daily'][number]>();
  const previous = new Map<string, Omit<UsageTotals, 'turns'>>();
  for (const { provider, event } of [...entries].sort((a, b) => a.event.createdAt.localeCompare(b.event.createdAt) || a.event.sequence - b.event.sequence)) {
    const model = event.model || 'default';
    let delta: Omit<UsageTotals, 'turns'> = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens, reasoningTokens: event.reasoningTokens, costUsd: event.costUsd };
    if (event.cumulative) {
      const key = `${event.sessionId}|${model}`;
      const prev = previous.get(key);
      previous.set(key, delta);
      if (prev && prev.inputTokens + prev.outputTokens <= event.inputTokens + event.outputTokens) {
        const next = { ...delta };
        for (const field of FIELDS) next[field] = Math.max(0, delta[field] - prev[field]);
        next.costUsd = delta.costUsd === null ? null : Math.max(0, delta.costUsd - (prev.costUsd ?? 0));
        delta = next;
      }
      if (FIELDS.every(field => delta[field] === 0)) continue;
    }
    const date = event.createdAt.slice(0, 10);
    if (since && date < since) continue;
    const modelKey = `${provider}|${model}`;
    const m = byModel.get(modelKey) ?? { provider, model, sessions: 0, sessionIds: new Set<string>(), ...empty() };
    add(m, delta);
    m.sessionIds.add(event.sessionId);
    m.sessions = m.sessionIds.size;
    byModel.set(modelKey, m);
    const dayKey = `${date}|${provider}`;
    const d = daily.get(dayKey) ?? { date, provider, ...empty() };
    add(d, delta);
    daily.set(dayKey, d);
  }
  return {
    generatedAt: now.toISOString(),
    source: options.source,
    byModel: [...byModel.values()].map(({ sessionIds: _ids, ...rest }) => rest).sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider)),
  };
}
