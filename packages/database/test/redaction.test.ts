import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Store } from '../src/index.js';

it('does not persist common API key forms in tasks or events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-redact-'));
  const filename = join(dir, 'db.sqlite');
  const secret = `sk-${'a'.repeat(24)}`;
  const uncommonSecret = 'private-credential-value-987654321';
  const store = new Store(filename);
  let sessionId = '';
  try {
    const now = new Date().toISOString();
    const projectId = randomUUID();
    sessionId = randomUUID();
    const taskId = randomUUID();
    const runId = randomUUID();
    store.putProject({ id: projectId, name: 'test', path: dir, branch: null, createdAt: now });
    store.saveSession({ id: sessionId, projectId, config: { provider: 'codex' }, status: 'running', providerSessionId: null, createdAt: now, updatedAt: now });
    store.saveTask({ id: taskId, sessionId, prompt: `key ${secret}`, createdAt: now });
    store.saveRun({ id: runId, taskId, sessionId, status: 'running', startedAt: now, finishedAt: null, error: null });
    const event = store.appendEvent(sessionId, runId, { type: 'message', role: 'assistant', text: `Bearer ${secret}` });
    expect(event.type === 'message' && event.text).not.toContain(secret);
    store.appendEvent(sessionId, runId, { type: 'tool_result', toolCallId: 'one', toolName: 'Read', output: uncommonSecret, success: true });
    store.saveRun({ id: runId, taskId, sessionId, status: 'failed', startedAt: now, finishedAt: now, error: `api_key=${secret}` });
    expect(store.run(runId)?.error).not.toContain(secret);
  } finally { store.close(); }
  expect(await readFile(filename, 'utf8')).not.toContain(secret);
  expect(await readFile(filename, 'utf8')).not.toContain(uncommonSecret);
  expect((await stat(`${filename}.key`)).mode & 0o077).toBe(0);
  const reopened = new Store(filename);
  expect(reopened.events(sessionId)).toHaveLength(2);
  reopened.close();
  await unlink(`${filename}.key`);
  expect(() => new Store(filename)).toThrow('Runtime data key is missing');
  await rm(dir, { recursive: true, force: true });
});

it('migrates an existing plaintext payload row on open', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-hub-migrate-'));
  const filename = join(dir, 'db.sqlite');
  const projectId = randomUUID();
  const project = { id: projectId, name: 'legacy-project', path: dir, branch: null, createdAt: new Date().toISOString() };
  const first = new Store(filename);
  first.putProject(project);
  first.close();
  const db = new Database(filename);
  db.prepare('UPDATE projects SET json=? WHERE id=?').run(JSON.stringify(project), projectId);
  db.close();
  const migrated = new Store(filename);
  expect(migrated.project(projectId)).toEqual(project);
  migrated.close();
  expect(await readFile(filename, 'utf8')).not.toContain('legacy-project');
  await rm(dir, { recursive: true, force: true });
});
