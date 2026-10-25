import { expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describeClaudeApproval, normalizeClaudeMessage } from '../src/index.js';

it('normalizes Claude assistant and tool result blocks', () => {
  const assistant = { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }, { type: 'tool_use', id: 'tool-1', name: 'Read' }] } } as unknown as SDKMessage;
  expect(normalizeClaudeMessage(assistant)).toEqual([
    { type: 'message', role: 'assistant', text: 'done' },
    { type: 'tool_start', toolCallId: 'tool-1', toolName: 'Read', description: 'Read' },
  ]);
  const user = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents', is_error: false }] } } as unknown as SDKMessage;
  expect(normalizeClaudeMessage(user)).toEqual([{ type: 'tool_result', toolCallId: 'tool-1', toolName: 'tool', output: 'file contents', success: true }]);
});

it('shows the requested command without persisting the full tool input', () => {
  expect(describeClaudeApproval('Bash', { command: 'npm test', hidden: 'private file contents' })).toContain('npm test');
  expect(describeClaudeApproval('Bash', { command: 'npm test', hidden: 'private file contents' })).not.toContain('private file contents');
});
