import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/index.js';

it('does not persist common API key forms in tasks or events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-redact-'));
  const filename = join(dir, 'db.sqlite');
  const secret = `sk-${'a'.repeat(24)}`;
  const store = new Store(filename);
  try {
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const taskId = randomUUID();
    const runId = randomUUID();
    store.putProject({ id: projectId, name: 'test', path: dir, branch: null, createdAt: now });
    store.saveSession({ id: sessionId, projectId, config: { provider: 'codex' }, status: 'running', providerSessionId: null, createdAt: now, updatedAt: now });
    store.saveTask({ id: taskId, sessionId, prompt: `key ${secret}`, createdAt: now });
    store.saveRun({ id: runId, taskId, sessionId, status: 'running', startedAt: now, finishedAt: null, error: null });
    const event = store.appendEvent(sessionId, runId, { type: 'message', role: 'assistant', text: `Bearer ${secret}` });
    expect(event.type === 'message' && event.text).not.toContain(secret);
    store.saveRun({ id: runId, taskId, sessionId, status: 'failed', startedAt: now, finishedAt: now, error: `api_key=${secret}` });
    expect(store.run(runId)?.error).not.toContain(secret);
  } finally { store.close(); }
  expect(await readFile(filename, 'utf8')).not.toContain(secret);
  await rm(dir, { recursive: true, force: true });
});
