import { expect, it } from 'vitest';
import { normalizeCodexItem } from '../src/index.js';

it('normalizes completed Codex items and ignores unknown shapes', () => {
  expect(normalizeCodexItem({ id: 'a', type: 'agentMessage', text: 'hello' }, 'completed')).toEqual([{ type: 'message', role: 'assistant', text: 'hello' }]);
  expect(normalizeCodexItem({ id: 'b', type: 'commandExecution', command: 'pwd' }, 'started')).toEqual([{ type: 'tool_start', toolCallId: 'b', toolName: 'commandExecution', description: 'pwd' }]);
  expect(normalizeCodexItem({ id: 'b', type: 'commandExecution', status: 'failed', aggregatedOutput: 'denied' }, 'completed')).toEqual([{ type: 'tool_result', toolCallId: 'b', toolName: 'commandExecution', output: 'denied', success: false }]);
  expect(normalizeCodexItem({ type: 'newProviderItem' }, 'completed')).toEqual([]);
});
