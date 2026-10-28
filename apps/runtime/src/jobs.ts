import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ApprovalRisk, Job } from '@agentic-hub/types';
import { redactStoredText } from '@agentic-hub/database';

const MAX_OUTPUT = 400_000;
const MAX_JOBS = 200;

export type JobChunk = { jobId: string; chunk: string } | { jobId: string; done: Job };

export interface StartJob {
  projectId: string;
  kind: Job['kind'];
  title: string;
  cwd: string;
  /** argv form; no shell unless `shell` is set. */
  command: string;
  args?: string[];
  shell?: boolean;
  risk: ApprovalRisk;
  /** Pulls a link out of the finished output, e.g. a PR or deployment URL. */
  resultUrl?: (output: string) => string | null;
  timeoutMs?: number;
}

/** Runs processes for the user and streams their output. Kept in memory; capped. */
export class JobRunner {
  private jobs = new Map<string, Job>();
  private processes = new Map<string, ChildProcess>();
  private bus = new EventEmitter();
  constructor() { this.bus.setMaxListeners(0); }

  list(projectId?: string): Job[] {
    return [...this.jobs.values()].filter(job => !projectId || job.projectId === projectId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  get(id: string): Job | null { return this.jobs.get(id) ?? null; }
  subscribe(id: string, listener: (chunk: JobChunk) => void): () => void {
    this.bus.on(id, listener);
    return () => this.bus.off(id, listener);
  }
  subscribeAll(listener: (chunk: JobChunk) => void): () => void {
    this.bus.on('*', listener);
    return () => this.bus.off('*', listener);
  }

  start(input: StartJob): Job {
    const display = input.shell ? input.command : [input.command, ...(input.args ?? [])].join(' ');
    const job: Job = {
      id: randomUUID(), projectId: input.projectId, kind: input.kind, title: input.title, command: redactStoredText(display),
      status: 'running', exitCode: null, startedAt: new Date().toISOString(), finishedAt: null, output: '', risk: input.risk, resultUrl: null,
    };
    this.jobs.set(job.id, job);
    this.prune();
    const shell = process.env.SHELL || '/bin/zsh';
    const child = input.shell
      ? spawn(shell, ['-lc', input.command], { cwd: input.cwd, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      : spawn(input.command, input.args ?? [], { cwd: input.cwd, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    this.processes.set(job.id, child);
    const append = (data: Buffer | string) => {
      const chunk = redactStoredText(data.toString());
      if (job.output.length < MAX_OUTPUT) job.output += chunk.slice(0, MAX_OUTPUT - job.output.length);
      this.emit(job.id, { jobId: job.id, chunk });
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = input.timeoutMs ? setTimeout(() => this.cancel(job.id), input.timeoutMs) : null;
    const finish = (code: number | null, error?: Error) => {
      if (job.status !== 'running') return;
      if (timer) clearTimeout(timer);
      if (error) append(`\n${error.message.includes('ENOENT') ? `${input.command} is not installed or not on PATH.` : error.message}\n`);
      job.exitCode = code;
      job.status = this.cancelled.has(job.id) ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
      job.finishedAt = new Date().toISOString();
      job.resultUrl = job.status === 'succeeded' ? input.resultUrl?.(job.output) ?? null : null;
      this.processes.delete(job.id);
      this.cancelled.delete(job.id);
      this.emit(job.id, { jobId: job.id, done: { ...job } });
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
    return { ...job };
  }

  /** Records an action that already finished in-process, so it shows in the activity feed. */
  record(input: Pick<Job, 'projectId' | 'kind' | 'title' | 'command' | 'output' | 'risk' | 'startedAt'> & { status: 'succeeded' | 'failed' }): Job {
    const job: Job = { ...input, id: randomUUID(), exitCode: input.status === 'succeeded' ? 0 : 1, finishedAt: new Date().toISOString(), resultUrl: null };
    this.jobs.set(job.id, job);
    this.prune();
    this.emit(job.id, { jobId: job.id, done: { ...job } });
    return { ...job };
  }

  private cancelled = new Set<string>();
  cancel(id: string): boolean {
    const child = this.processes.get(id);
    if (!child?.pid) return false;
    this.cancelled.add(id);
    // Kill the whole process group, so `sh -c "pnpm dev"` stops its children too.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    setTimeout(() => { if (this.processes.has(id)) { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ } } }, 3_000).unref();
    return true;
  }

  close(): void { for (const id of this.processes.keys()) this.cancel(id); }

  /** Resolves when the job finishes (for actions whose result the caller awaits). */
  wait(id: string): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new Error('Job not found'));
    if (job.status !== 'running') return Promise.resolve({ ...job });
    return new Promise(resolve => {
      const off = this.subscribe(id, chunk => { if ('done' in chunk) { off(); resolve(chunk.done); } });
    });
  }

  private emit(id: string, chunk: JobChunk) {
    this.bus.emit(id, chunk);
    this.bus.emit('*', chunk);
  }
  private prune() {
    if (this.jobs.size <= MAX_JOBS) return;
    for (const job of [...this.jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      if (this.jobs.size <= MAX_JOBS) break;
      if (job.status !== 'running') this.jobs.delete(job.id);
    }
  }
}
