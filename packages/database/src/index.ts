import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  AgentEventSchema, ApprovalRequestSchema, ProjectSchema, QueuedMessageSchema, SessionSchema, TaskRunSchema, TaskSchema,
  type AgentEvent, type ApprovalRequest, type NewAgentEvent, type Project, type QueuedMessage, type Session, type Task, type TaskRun,
} from '@agentic-hub/types';

const parse = <T>(schema: { parse(value: unknown): T }, value: unknown): T => schema.parse(value);
const fromRow = <T>(schema: { parse(value: unknown): T }, row: unknown, key: Buffer): T | null => row && typeof row === 'object' && 'json' in row ? parse(schema, JSON.parse(unseal(String(row.json), key))) : null;

function storageKey(filename: string, db: DatabaseSync): Buffer {
  if (filename === ':memory:') return randomBytes(32);
  const keyPath = `${filename}.key`;
  if (!existsSync(keyPath)) {
    const encrypted = db.prepare("SELECT value FROM runtime_metadata WHERE key='encrypted_payloads'").get();
    if (encrypted) throw new Error('Runtime data key is missing');
    try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (!existsSync(keyPath)) throw error; }
  }
  if ((statSync(keyPath).mode & 0o077) !== 0) throw new Error('Runtime data key must be owner-only');
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Invalid runtime data key');
  return key;
}

function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`;
}

function unseal(value: string, key: Buffer): string {
  if (!value.startsWith('enc:v1:')) return value; // Existing databases are migrated on open.
  const bytes = Buffer.from(value.slice(7), 'base64');
  if (bytes.length < 28) throw new Error('Invalid encrypted runtime payload');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

/** Best-effort removal of common credentials before text reaches durable storage. */
export function redactStoredText(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{25,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[REDACTED]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|secret|password|authorization)\s*[:=]\s*["']?)[^\s"'`,;]+/gi, '$1[REDACTED]');
}

function redactEvent(event: NewAgentEvent): NewAgentEvent {
  switch (event.type) {
    case 'message': case 'reasoning_summary': return { ...event, text: redactStoredText(event.text) };
    case 'tool_start': return { ...event, description: redactStoredText(event.description) };
    case 'tool_result': return { ...event, output: redactStoredText(event.output) };
    case 'approval_requested': return { ...event, approval: { ...event.approval, description: redactStoredText(event.approval.description) } };
    case 'error': return { ...event, message: redactStoredText(event.message) };
    case 'completed': return { ...event, summary: event.summary === null ? null : redactStoredText(event.summary) };
    default: return event;
  }
}

export class Store {
  readonly db: DatabaseSync;
  readonly filename: string;
  private readonly key: Buffer;
  constructor(filename: string) {
    this.filename = filename;
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), task_run_id TEXT NOT NULL REFERENCES task_runs(id), sequence INTEGER NOT NULL, json TEXT NOT NULL, UNIQUE(session_id, sequence));
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queued_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), created_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_by_session ON events(session_id, sequence);
      CREATE INDEX IF NOT EXISTS queued_messages_by_session ON queued_messages(session_id, created_at);
    `);
    try {
      this.key = storageKey(filename, this.db);
      this.migratePlaintextRows();
      this.db.prepare("INSERT INTO runtime_metadata (key,value) VALUES ('encrypted_payloads','v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      this.recover();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void { if (this.db.isOpen) this.db.close(); }
  /** Runs `fn` in one immediate transaction (node:sqlite has no transaction helper). */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private migratePlaintextRows(): void {
    let migrated = false;
    this.transaction(() => {
      for (const table of ['projects', 'sessions', 'tasks', 'task_runs', 'events', 'approvals', 'queued_messages']) {
        const rows = this.db.prepare(`SELECT rowid, json FROM ${table} WHERE json NOT LIKE 'enc:v1:%'`).all() as { rowid: number; json: string }[];
        const update = this.db.prepare(`UPDATE ${table} SET json=? WHERE rowid=?`);
        for (const row of rows) {
          update.run(seal(row.json, this.key), row.rowid);
          migrated = true;
        }
      }
    });
    if (migrated) this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  }
  private recover(): void {
    this.transaction(() => {
      for (const row of this.db.prepare("SELECT json FROM sessions WHERE status IN ('running','awaiting_approval')").all()) {
        const session = fromRow(SessionSchema, row, this.key)!;
        this.saveSession({ ...session, status: 'interrupted', updatedAt: new Date().toISOString() });
      }
      for (const row of this.db.prepare("SELECT json FROM task_runs WHERE status IN ('queued','running','awaiting_approval')").all()) {
        const run = fromRow(TaskRunSchema, row, this.key)!;
        this.saveRun({ ...run, status: 'interrupted', finishedAt: new Date().toISOString(), error: 'Runtime restarted' });
      }
    });
  }
  putProject(project: Project): void {
    ProjectSchema.parse(project);
    this.db.prepare('INSERT INTO projects (id,path,json) VALUES (?,?,?)').run(project.id, project.path, seal(JSON.stringify(project), this.key));
  }
  project(id: string): Project | null { return fromRow(ProjectSchema, this.db.prepare('SELECT json FROM projects WHERE id=?').get(id), this.key); }
  projectByPath(path: string): Project | null { return fromRow(ProjectSchema, this.db.prepare('SELECT json FROM projects WHERE path=?').get(path), this.key); }
  projects(): Project[] { return this.db.prepare('SELECT json FROM projects ORDER BY rowid DESC').all().map(row => fromRow(ProjectSchema, row, this.key)!); }
  saveSession(session: Session): void {
    SessionSchema.parse(session);
    this.db.prepare('INSERT INTO sessions (id,project_id,status,updated_at,json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,json=excluded.json').run(session.id, session.projectId, session.status, session.updatedAt, seal(JSON.stringify(session), this.key));
  }
  session(id: string): Session | null { return fromRow(SessionSchema, this.db.prepare('SELECT json FROM sessions WHERE id=?').get(id), this.key); }
  sessions(): Session[] { return this.db.prepare('SELECT json FROM sessions ORDER BY updated_at DESC').all().map(row => fromRow(SessionSchema, row, this.key)!); }
  enqueueMessage(sessionId: string, text: string): QueuedMessage {
    const queued = QueuedMessageSchema.parse({ id: randomUUID(), sessionId, text: redactStoredText(text), createdAt: new Date().toISOString() });
    this.db.prepare('INSERT INTO queued_messages (id,session_id,created_at,json) VALUES (?,?,?,?)').run(queued.id, queued.sessionId, queued.createdAt, seal(JSON.stringify(queued), this.key));
    return queued;
  }
  queuedMessages(sessionId: string): QueuedMessage[] { return this.db.prepare('SELECT json FROM queued_messages WHERE session_id=? ORDER BY created_at, rowid').all(sessionId).map(row => fromRow(QueuedMessageSchema, row, this.key)!); }
  queuedSessions(): string[] { return (this.db.prepare('SELECT DISTINCT session_id FROM queued_messages').all() as { session_id: string }[]).map(row => row.session_id); }
  deleteQueuedMessage(sessionId: string, id: string): boolean { return this.db.prepare('DELETE FROM queued_messages WHERE session_id=? AND id=?').run(sessionId, id).changes > 0; }
  saveTask(task: Task): void {
    const stored = TaskSchema.parse({ ...task, prompt: redactStoredText(task.prompt) });
    this.db.prepare('INSERT INTO tasks (id,session_id,json) VALUES (?,?,?)').run(stored.id, stored.sessionId, seal(JSON.stringify(stored), this.key));
  }
  saveRun(run: TaskRun): void {
    const stored = TaskRunSchema.parse({ ...run, error: run.error === null ? null : redactStoredText(run.error) });
    this.db.prepare('INSERT INTO task_runs (id,task_id,session_id,status,json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json').run(stored.id, stored.taskId, stored.sessionId, stored.status, seal(JSON.stringify(stored), this.key));
  }
  run(id: string): TaskRun | null { return fromRow(TaskRunSchema, this.db.prepare('SELECT json FROM task_runs WHERE id=?').get(id), this.key); }
  runs(sessionId: string): TaskRun[] { return this.db.prepare('SELECT json FROM task_runs WHERE session_id=? ORDER BY rowid').all(sessionId).map(row => fromRow(TaskRunSchema, row, this.key)!); }
  appendEvent(sessionId: string, runId: string, event: NewAgentEvent): AgentEvent {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence)+1,0) AS next FROM events WHERE session_id=?').get(sessionId) as { next: number };
      const full = AgentEventSchema.parse({ ...redactEvent(event), id: randomUUID(), sessionId, taskRunId: runId, sequence: row.next, createdAt: new Date().toISOString() });
      this.db.prepare('INSERT INTO events (id,session_id,task_run_id,sequence,json) VALUES (?,?,?,?,?)').run(full.id, sessionId, runId, full.sequence, seal(JSON.stringify(full), this.key));
      return full;
    });
  }
  events(sessionId: string, after = -1): AgentEvent[] { return this.db.prepare('SELECT json FROM events WHERE session_id=? AND sequence>? ORDER BY sequence').all(sessionId, after).map(row => fromRow(AgentEventSchema, row, this.key)!); }
  nextSequence(sessionId: string): number { return (this.db.prepare('SELECT COALESCE(MAX(sequence)+1,0) AS next FROM events WHERE session_id=?').get(sessionId) as { next: number }).next; }
  saveApproval(approval: ApprovalRequest): void {
    const stored = ApprovalRequestSchema.parse({ ...approval, description: redactStoredText(approval.description) });
    this.db.prepare('INSERT INTO approvals (id,session_id,status,json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json').run(stored.id, stored.sessionId, stored.status, seal(JSON.stringify(stored), this.key));
  }
  approval(id: string): ApprovalRequest | null { return fromRow(ApprovalRequestSchema, this.db.prepare('SELECT json FROM approvals WHERE id=?').get(id), this.key); }
  pendingApprovals(sessionId: string): ApprovalRequest[] {
    return this.db.prepare("SELECT json FROM approvals WHERE session_id=? AND status='pending'").all(sessionId).map(row => fromRow(ApprovalRequestSchema, row, this.key)!);
  }
  /** Session title: the first line of the first user message, when there is one. */
  sessionTitle(sessionId: string): string | null {
    for (const row of this.db.prepare('SELECT json FROM events WHERE session_id=? ORDER BY sequence LIMIT 8').all(sessionId)) {
      const event = fromRow(AgentEventSchema, row, this.key);
      if (event?.type === 'message' && event.role === 'user') return event.text.split('\n')[0]!.trim().slice(0, 120) || null;
    }
    return null;
  }
  /** Title and number of user/assistant messages, from one pass over the session's events. */
  sessionSummary(sessionId: string): { title: string | null; messageCount: number } {
    let title: string | null = null;
    let messageCount = 0;
    for (const event of this.events(sessionId)) {
      if (event.type !== 'message') continue;
      messageCount++;
      if (title === null && event.role === 'user') title = event.text.split('\n')[0]!.trim().slice(0, 120) || null;
    }
    return { title, messageCount };
  }
  /** Conversation history for providers that need the full transcript on every turn. */
  transcript(sessionId: string): { role: 'user' | 'assistant'; text: string }[] {
    return this.events(sessionId).flatMap(event => event.type === 'message' ? [{ role: event.role, text: event.text }] : []);
  }
  /** Encrypted key-value storage for credentials and runtime settings. Values never leave the runtime unless a caller returns them. */
  setSecret(name: string, value: string): void {
    this.db.prepare('INSERT INTO secrets (name,value,updated_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(name, seal(value, this.key), new Date().toISOString());
  }
  secret(name: string): string | null {
    const row = this.db.prepare('SELECT value FROM secrets WHERE name=?').get(name) as { value: string } | undefined;
    return row ? unseal(row.value, this.key) : null;
  }
  deleteSecret(name: string): void { this.db.prepare('DELETE FROM secrets WHERE name=?').run(name); }
}
