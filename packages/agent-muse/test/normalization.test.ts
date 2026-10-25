import { describe, expect, it } from 'vitest';
import { choiceFor, describeMuseApproval, MuseAdapter, normalizeMuseItem } from '../src/index.js';

type Request = Parameters<typeof choiceFor>[0];
const request = (choices: { choiceId: string; decision: string; scope: string }[]): Request => ({
  approvalId: 'a', availableChoices: choices.map(c => ({ ...c, label: c.choiceId })), toolName: 'shell', subject: { kind: 'shell', command: 'rm -rf build' },
} as unknown as Request);

describe('Muse approvals', () => {
  it('prefers a one-time grant and never invents a choice', () => {
    const offered = request([
      { choiceId: 'always', decision: 'approvedForSession', scope: 'session' },
      { choiceId: 'once', decision: 'approved', scope: 'once' },
      { choiceId: 'no', decision: 'denied', scope: 'once' },
    ]);
    expect(choiceFor(offered, 'approve')).toBe('once');
    expect(choiceFor(offered, 'deny')).toBe('no');
    expect(choiceFor(request([{ choiceId: 'no', decision: 'denied', scope: 'once' }]), 'approve')).toBeNull();
    expect(describeMuseApproval(offered)).toBe('shell requires approval — rm -rf build');
  });
});

describe('normalizeMuseItem', () => {
  it('emits a tool start once and a result at the terminal revision', () => {
    const seen = new Map<string, 'started' | 'done'>();
    const open = { itemId: 'i1', kind: 'toolCall', status: 'inProgress', tool: 'shell', revision: 1, displayLabel: { active: 'Running tests', done: 'Ran tests' } };
    expect(normalizeMuseItem(open as never, seen)).toEqual([{ type: 'tool_start', toolCallId: 'i1', toolName: 'shell', description: 'Running tests' }]);
    expect(normalizeMuseItem({ ...open, revision: 2 } as never, seen)).toEqual([]);
    expect(normalizeMuseItem({ ...open, status: 'completed', visibleOutput: 'ok', revision: 3 } as never, seen)).toEqual([{ type: 'tool_result', toolCallId: 'i1', toolName: 'shell', output: 'ok', success: true }]);
    expect(normalizeMuseItem({ ...open, status: 'completed', revision: 4 } as never, seen)).toEqual([]);
  });
  it('emits agent messages and reasoning only when complete', () => {
    const seen = new Map<string, 'started' | 'done'>();
    expect(normalizeMuseItem({ itemId: 'm', kind: 'agentMessage', status: 'inProgress', text: 'Hel', revision: 1 } as never, seen)).toEqual([]);
    expect(normalizeMuseItem({ itemId: 'm', kind: 'agentMessage', status: 'completed', text: 'Hello', revision: 2 } as never, seen)).toEqual([{ type: 'message', role: 'assistant', text: 'Hello' }]);
    expect(normalizeMuseItem({ itemId: 'r', kind: 'reasoning', status: 'completed', summary: ['a', 'b'], revision: 1 } as never, seen)).toEqual([{ type: 'reasoning_summary', text: 'a\nb' }]);
  });
});

it('reports a missing CLI as not installed with install guidance', async () => {
  const info = await new MuseAdapter('/nonexistent/muse').readiness();
  expect(info).toMatchObject({ installed: false, ready: false, kind: 'agent', authMethod: 'cli' });
  expect(info.reason).toContain('install.sh');
});
