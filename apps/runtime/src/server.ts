import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { AgentRegistry, HubError, SessionManager, providerErrorMessage } from '@agentic-hub/agent-core';
import { Store } from '@agentic-hub/database';
import { branchOf, diffOf, resolveRepository } from '@agentic-hub/git';
import { AgentProviderSchema, CreateProjectRequestSchema, CreateSessionRequestSchema, MODEL_CHAT_PROJECT_ID, PairDeviceRequestSchema, ResolveApprovalRequestSchema, SendMessageRequestSchema, SetCredentialRequestSchema, UpdatePairingRequestSchema, type AgentProvider } from '@agentic-hub/types';
import type { ControlPlaneConnector } from './control-plane.js';
import type { CredentialStore } from './credentials.js';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { developerActivity, updateRepository } from './developer-activity.js';
import { ideUpdate, openIdeUpdate } from './ide-update.js';

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

export interface RuntimeServerOptions {
  credentials?: CredentialStore;
  controlPlane?: ControlPlaneConnector;
  /** Checks an API key with its provider before it is stored. */
  verifyCredential?: (provider: AgentProvider, apiKey: string) => Promise<void>;
  version?: string;
}

export function createRuntimeServer(store: Store, registry: AgentRegistry, manager: SessionManager, token: string, options: RuntimeServerOptions = {}): Server {
  if (!store.project(MODEL_CHAT_PROJECT_ID)) {
    store.putProject({ id: MODEL_CHAT_PROJECT_ID, name: 'Chats', path: 'model://chats', branch: null, createdAt: new Date().toISOString() });
  }
  const startedAt = new Date().toISOString();
  const version = options.version ?? '0.2.0';
  const provider = (raw: string): AgentProvider => {
    const parsed = AgentProviderSchema.safeParse(raw);
    if (!parsed.success || !registry.has(parsed.data)) throw new HubError('NOT_FOUND', 404, 'Provider not found');
    return parsed.data;
  };
  return createServer(async (request, response) => {
    try {
      const method = request.method ?? '';
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (method === 'GET' && path === '/health') {
        const providers = await registry.list();
        send(response, 200, { state: providers.some(p => p.ready) ? 'ready' : 'degraded', version, startedAt, providers });
        return;
      }
      if (!authorized(request, token)) throw new HubError('UNAUTHORIZED', 401, 'Bearer token required');
      if (method === 'GET' && path === '/providers') { send(response, 200, { providers: await registry.list(url.searchParams.has('refresh')) }); return; }
      if (path === '/settings') {
        if (method === 'GET') { send(response, 200, { autoApprove: manager.autoApprove() }); return; }
        if (method === 'PATCH') { const input = z.object({ autoApprove: z.boolean() }).parse(await body(request)); send(response, 200, { autoApprove: manager.setAutoApprove(input.autoApprove) }); return; }
      }
      if (method === 'GET' && path === '/ide-update') { send(response, 200, { update: await ideUpdate() }); return; }
      if (method === 'POST' && path === '/ide-update/open') { await openIdeUpdate(); send(response, 200, { opened: true }); return; }
      const providerMatch = /^\/providers\/([a-z]+)\/(models|credentials)$/.exec(path);
      if (providerMatch) {
        const id = provider(providerMatch[1]!);
        if (method === 'GET' && providerMatch[2] === 'models') { send(response, 200, { provider: id, models: await registry.listModels(id) }); return; }
        if (providerMatch[2] === 'credentials' && (method === 'PUT' || method === 'DELETE')) {
          const credentials = options.credentials;
          if (!credentials?.accepts(id)) throw new HubError('UNSUPPORTED_ACTION', 422, 'This provider signs in through its own CLI, not an API key');
          if (method === 'PUT') {
            const input = SetCredentialRequestSchema.parse(await body(request));
            if (options.verifyCredential) {
              try { await options.verifyCredential(id, input.apiKey); }
              catch (error) { throw new HubError('VALIDATION_ERROR', 400, providerErrorMessage(error, id === 'openai' ? 'OpenAI' : 'Anthropic')); }
            }
            credentials.set(id, input.apiKey);
          } else credentials.clear(id);
          registry.invalidate(id);
          send(response, 200, { provider: await registry.readiness(id, true) }); return;
        }
      }
      if (path === '/pairing' && options.controlPlane) {
        const plane = options.controlPlane;
        if (method === 'GET') { send(response, 200, { pairing: plane.status() }); return; }
        if (method === 'POST') { send(response, 200, { pairing: await plane.pair(PairDeviceRequestSchema.parse(await body(request))) }); return; }
        if (method === 'PATCH') { send(response, 200, { pairing: plane.update(UpdatePairingRequestSchema.parse(await body(request))) }); return; }
        if (method === 'DELETE') { send(response, 200, { pairing: await plane.unpair() }); return; }
      }
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
      const projectAction = /^\/projects\/([0-9a-f-]{36})\/(activity|update)$/.exec(path);
      if (projectAction) {
        const project = store.project(projectAction[1]!);
        if (!project || project.id === MODEL_CHAT_PROJECT_ID) throw new HubError('NOT_FOUND', 404, 'Repository not found');
        const activeRun = store.sessions().some(session => session.projectId === project.id && manager.isActive(session.id));
        if (method === 'GET' && projectAction[2] === 'activity') {
          const activity = await developerActivity(project.path);
          if (activeRun) activity.update.blockedReason = 'Stop active runs before updating this repository.';
          send(response, 200, { activity }); return;
        }
        if (method === 'POST' && projectAction[2] === 'update') {
          if (activeRun) throw new HubError('CONFLICT', 409, 'Stop active runs before updating this repository.');
          await updateRepository(project.path); send(response, 200, { updated: true }); return;
        }
      }
      if (method === 'GET' && path === '/sessions') {
        const sessions = store.sessions();
        const summaries = sessions.map(s => [s.id, store.sessionSummary(s.id)] as const);
        send(response, 200, { sessions, titles: Object.fromEntries(summaries.map(([id, s]) => [id, s.title])), messageCounts: Object.fromEntries(summaries.map(([id, s]) => [id, s.messageCount])) }); return;
      }
      if (method === 'POST' && path === '/sessions') {
        const input = CreateSessionRequestSchema.parse(await body(request));
        send(response, 201, { session: await manager.create(input.projectId, input.config) }); return;
      }
      const queuedMatch = /^\/sessions\/([0-9a-f-]{36})\/queue\/([0-9a-f-]{36})$/.exec(path);
      if (method === 'DELETE' && queuedMatch) {
        if (!store.session(queuedMatch[1]!)) throw new HubError('NOT_FOUND', 404, 'Session not found');
        if (!store.deleteQueuedMessage(queuedMatch[1]!, queuedMatch[2]!)) throw new HubError('NOT_FOUND', 404, 'Queued message not found');
        send(response, 200, { removed: true }); return;
      }
      const sessionMatch = /^\/sessions\/([0-9a-f-]{36})(?:\/(messages|queue|cancel|events|diff))?$/.exec(path);
      if (sessionMatch) {
        const id = sessionMatch[1]!;
        const action = sessionMatch[2];
        const session = store.session(id);
        if (!session) throw new HubError('NOT_FOUND', 404, 'Session not found');
        if (method === 'GET' && !action) { send(response, 200, { session, title: store.sessionTitle(id), pendingApprovals: store.pendingApprovals(id) }); return; }
        if (method === 'GET' && action === 'queue') { send(response, 200, { messages: store.queuedMessages(id) }); return; }
        if (method === 'POST' && action === 'messages') {
          const input = SendMessageRequestSchema.parse(await body(request));
          send(response, 202, await manager.sendOrQueue(id, input.text)); return;
        }
        if (method === 'POST' && action === 'cancel') { send(response, 200, { session: await manager.cancel(id) }); return; }
        if (method === 'GET' && action === 'diff') {
          if (session.projectId === MODEL_CHAT_PROJECT_ID) { send(response, 200, { diff: { files: [], patch: '' } }); return; }
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
          // Deltas are ephemeral: no id, so a reconnect never replays them.
          const unsubscribeDeltas = manager.subscribeDeltas(id, delta => { if (!response.destroyed) response.write(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`); });
          for (const event of store.events(id, after)) write(event);
          const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15_000);
          response.on('close', () => { clearInterval(heartbeat); unsubscribe(); unsubscribeDeltas(); });
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
