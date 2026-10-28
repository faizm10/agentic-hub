import { expect, it } from 'vitest';
import { codexUsage, normalizeCodexItem } from '../src/index.js';

it('normalizes completed Codex items and ignores unknown shapes', () => {
  expect(normalizeCodexItem({ id: 'a', type: 'agentMessage', text: 'hello' }, 'completed')).toEqual([{ type: 'message', role: 'assistant', text: 'hello' }]);
  expect(normalizeCodexItem({ id: 'b', type: 'commandExecution', command: 'pwd' }, 'started')).toEqual([{ type: 'tool_start', toolCallId: 'b', toolName: 'commandExecution', description: 'pwd' }]);
  expect(normalizeCodexItem({ id: 'b', type: 'commandExecution', status: 'failed', aggregatedOutput: 'denied' }, 'completed')).toEqual([{ type: 'tool_result', toolCallId: 'b', toolName: 'commandExecution', output: 'denied', success: false }]);
  expect(normalizeCodexItem({ type: 'newProviderItem' }, 'completed')).toEqual([]);
});

it('maps thread token totals to a cumulative usage event', () => {
  expect(codexUsage({ totalTokens: 1500, inputTokens: 1000, cachedInputTokens: 600, cacheWriteInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 200 }, undefined)).toEqual({
    type: 'usage', model: 'default', cumulative: true, costUsd: null, inputTokens: 400, outputTokens: 500, cacheReadTokens: 600, cacheWriteTokens: 0, reasoningTokens: 200,
  });
});
