import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { AgentRegistry, HubError, SessionManager } from '@agentic-hub/agent-core';
import { Store } from '@agentic-hub/database';
import { branchOf, diffOf, resolveRepository } from '@agentic-hub/git';
import { CreateProjectRequestSchema, CreateSessionRequestSchema, ResolveApprovalRequestSchema, SendMessageRequestSchema } from '@agentic-hub/types';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  let data = '';
  for await (const chunk of request) {
    data += chunk.toString();
    if (data.length > 1_000_000) throw new HubError('VALIDATION_ERROR', 400, 'Request body is too large');
  }
  try { return JSON.parse(data); } catch { throw new HubError('VALIDATION_ERROR', 400, 'Invalid JSON body'); }
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createRuntimeServer(store: Store, registry: AgentRegistry, manager: SessionManager, token: string): Server {
  const startedAt = new Date().toISOString();
  return createServer(async (request, response) => {
    try {
      const method = request.method ?? '';
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (method === 'GET' && path === '/health') {
        const providers = await registry.list();
        send(response, 200, { state: providers.some(provider => provider.ready) ? 'ready' : 'degraded', version: '0.1.0', startedAt, providers });
        return;
      }
      if (!authorized(request, token)) throw new HubError('UNAUTHORIZED', 401, 'Bearer token required');
      if (method === 'GET' && path === '/providers') { send(response, 200, { providers: await registry.list() }); return; }
      if (method === 'GET' && path === '/projects') { send(response, 200, { projects: store.projects() }); return; }
      if (method === 'POST' && path === '/projects') {
        const input = CreateProjectRequestSchema.parse(await body(request));
        let canonical: string;
        try { canonical = await resolveRepository(input.path); }
        catch { throw new HubError('VALIDATION_ERROR', 400, 'Path must be an existing Git repository'); }
        const existing = store.projectByPath(canonical);
        if (existing) { send(response, 200, { project: existing }); return; }
        const project = { id: randomUUID(), name: input.name ?? basename(canonical), path: canonical, branch: await branchOf(canonical), createdAt: new Date().toISOString() };
        store.putProject(project);
        send(response, 201, { project }); return;
      }
      if (method === 'GET' && path === '/sessions') { send(response, 200, { sessions: store.sessions() }); return; }
      if (method === 'POST' && path === '/sessions') {
        const input = CreateSessionRequestSchema.parse(await body(request));
        send(response, 201, { session: await manager.create(input.projectId, input.config) }); return;
      }
      const sessionMatch = /^\/sessions\/([0-9a-f-]{36})(?:\/(messages|cancel|events|diff))?$/.exec(path);
      if (sessionMatch) {
        const id = sessionMatch[1]!;
        const action = sessionMatch[2];
        const session = store.session(id);
        if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
        if (method === 'GET' && !action) { send(response, 200, { session }); return; }
        if (method === 'POST' && action === 'messages') {
          const input = SendMessageRequestSchema.parse(await body(request));
          send(response, 202, await manager.send(id, input.text)); return;
        }
        if (method === 'POST' && action === 'cancel') { send(response, 200, { session: await manager.cancel(id) }); return; }
        if (method === 'GET' && action === 'diff') {
          const project = store.project(session.projectId)!;
          send(response, 200, { diff: await diffOf(project.path, project.id) }); return;
        }
        if (method === 'GET' && action === 'events') {
          const raw = url.searchParams.get('after') ?? request.headers['last-event-id'] ?? '-1';
          const after = Number(raw);
          if (!Number.isSafeInteger(after) || after < -1) throw new HubError('VALIDATION_ERROR', 400, 'Invalid event cursor');
          if (!request.headers.accept?.includes('text/event-stream')) {
            send(response, 200, { events: store.events(id, after), nextSequence: store.nextSequence(id) }); return;
          }
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          response.flushHeaders();
          let last = after;
          const write = (event: { sequence: number; type: string }) => {
            if (event.sequence <= last || response.destroyed) return;
            last = event.sequence;
            response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          };
          const unsubscribe = manager.subscribe(id, write);
          for (const event of store.events(id, after)) write(event);
          const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15_000);
          response.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
          return;
        }
      }
      const approvalMatch = /^\/approvals\/([0-9a-f-]{36})\/resolve$/.exec(path);
      if (method === 'POST' && approvalMatch) {
        const input = ResolveApprovalRequestSchema.parse(await body(request));
        send(response, 200, { approval: await manager.resolveApproval(approvalMatch[1]!, input.decision) }); return;
      }
      throw new HubError('NOT_FOUND', 404, 'Route not found');
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof ZodError) { send(response, 400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } }); return; }
      if (error instanceof HubError) { send(response, error.status, { error: { code: error.code, message: error.message } }); return; }
      send(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal runtime error' } });
    }
  });
}
