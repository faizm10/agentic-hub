import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  AgentEventSchema, ApprovalRequestSchema, ProjectSchema, SessionSchema, TaskRunSchema, TaskSchema,
  type AgentEvent, type ApprovalRequest, type NewAgentEvent, type Project, type Session, type Task, type TaskRun,
} from '@agentic-hub/types';

const parse = <T>(schema: { parse(value: unknown): T }, value: unknown): T => schema.parse(value);
const fromRow = <T>(schema: { parse(value: unknown): T }, row: unknown): T | null => row && typeof row === 'object' && 'json' in row ? parse(schema, JSON.parse(String(row.json))) : null;

export class Store {
  readonly db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), task_run_id TEXT NOT NULL REFERENCES task_runs(id), sequence INTEGER NOT NULL, json TEXT NOT NULL, UNIQUE(session_id, sequence));
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_by_session ON events(session_id, sequence);
    `);
    this.recover();
  }
  close(): void { this.db.close(); }
  private recover(): void {
    this.db.transaction(() => {
      for (const row of this.db.prepare("SELECT json FROM sessions WHERE status IN ('running','awaiting_approval')").all()) {
        const session = fromRow(SessionSchema, row)!;
        this.saveSession({ ...session, status: 'interrupted', updatedAt: new Date().toISOString() });
      }
      for (const row of this.db.prepare("SELECT json FROM task_runs WHERE status IN ('queued','running','awaiting_approval')").all()) {
        const run = fromRow(TaskRunSchema, row)!;
        this.saveRun({ ...run, status: 'interrupted', finishedAt: new Date().toISOString(), error: 'Runtime restarted' });
      }
    })();
  }
  putProject(project: Project): void {
    ProjectSchema.parse(project);
    this.db.prepare('INSERT INTO projects (id,path,json) VALUES (?,?,?)').run(project.id, project.path, JSON.stringify(project));
  }
  project(id: string): Project | null { return fromRow(ProjectSchema, this.db.prepare('SELECT json FROM projects WHERE id=?').get(id)); }
  projectByPath(path: string): Project | null { return fromRow(ProjectSchema, this.db.prepare('SELECT json FROM projects WHERE path=?').get(path)); }
  projects(): Project[] { return this.db.prepare('SELECT json FROM projects ORDER BY rowid DESC').all().map(row => fromRow(ProjectSchema, row)!); }
  saveSession(session: Session): void {
    SessionSchema.parse(session);
    this.db.prepare('INSERT INTO sessions (id,project_id,status,updated_at,json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,json=excluded.json').run(session.id, session.projectId, session.status, session.updatedAt, JSON.stringify(session));
  }
  session(id: string): Session | null { return fromRow(SessionSchema, this.db.prepare('SELECT json FROM sessions WHERE id=?').get(id)); }
  sessions(): Session[] { return this.db.prepare('SELECT json FROM sessions ORDER BY updated_at DESC').all().map(row => fromRow(SessionSchema, row)!); }
  saveTask(task: Task): void {
    TaskSchema.parse(task);
    this.db.prepare('INSERT INTO tasks (id,session_id,json) VALUES (?,?,?)').run(task.id, task.sessionId, JSON.stringify(task));
  }
  saveRun(run: TaskRun): void {
    TaskRunSchema.parse(run);
    this.db.prepare('INSERT INTO task_runs (id,task_id,session_id,status,json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json').run(run.id, run.taskId, run.sessionId, run.status, JSON.stringify(run));
  }
  run(id: string): TaskRun | null { return fromRow(TaskRunSchema, this.db.prepare('SELECT json FROM task_runs WHERE id=?').get(id)); }
  runs(sessionId: string): TaskRun[] { return this.db.prepare('SELECT json FROM task_runs WHERE session_id=? ORDER BY rowid').all(sessionId).map(row => fromRow(TaskRunSchema, row)!); }
  appendEvent(sessionId: string, runId: string, event: NewAgentEvent): AgentEvent {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence)+1,0) AS next FROM events WHERE session_id=?').get(sessionId) as { next: number };
      const full = AgentEventSchema.parse({ ...event, id: randomUUID(), sessionId, taskRunId: runId, sequence: row.next, createdAt: new Date().toISOString() });
      this.db.prepare('INSERT INTO events (id,session_id,task_run_id,sequence,json) VALUES (?,?,?,?,?)').run(full.id, sessionId, runId, full.sequence, JSON.stringify(full));
      return full;
    })();
  }
  events(sessionId: string, after = -1): AgentEvent[] { return this.db.prepare('SELECT json FROM events WHERE session_id=? AND sequence>? ORDER BY sequence').all(sessionId, after).map(row => fromRow(AgentEventSchema, row)!); }
  nextSequence(sessionId: string): number { return (this.db.prepare('SELECT COALESCE(MAX(sequence)+1,0) AS next FROM events WHERE session_id=?').get(sessionId) as { next: number }).next; }
  saveApproval(approval: ApprovalRequest): void {
    ApprovalRequestSchema.parse(approval);
    this.db.prepare('INSERT INTO approvals (id,session_id,status,json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json').run(approval.id, approval.sessionId, approval.status, JSON.stringify(approval));
  }
  approval(id: string): ApprovalRequest | null { return fromRow(ApprovalRequestSchema, this.db.prepare('SELECT json FROM approvals WHERE id=?').get(id)); }
}
