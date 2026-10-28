import { z } from 'zod';

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
/** Coding agents run in a local repository; model providers are conversational APIs. */
export const AgentProviderSchema = z.enum(['codex', 'claude', 'muse', 'openai', 'anthropic']);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const AgentCapabilitiesSchema = z.object({
  execution: z.boolean(),
  streaming: z.boolean(),
  interactiveMessages: z.boolean(),
  approvals: z.boolean(),
  cancellation: z.boolean(),
  gitDiff: z.boolean(),
  /** The provider can list its available models. */
  modelDiscovery: z.boolean().optional(),
  /** The provider streams partial text (`delta` stream records). */
  textDeltas: z.boolean().optional(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

export const AgentConfigSchema = z.object({
  provider: AgentProviderSchema,
  model: z.string().min(1).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ProviderInfoSchema = z.object({
  provider: AgentProviderSchema,
  displayName: z.string(),
  capabilities: AgentCapabilitiesSchema,
  installed: z.boolean(),
  authenticated: z.boolean(),
  ready: z.boolean(),
  reason: z.string().optional(),
  /** `agent`: executes in a repository with tools and approvals. `model`: conversational API. */
  kind: z.enum(['agent', 'model']).optional(),
  /** How the provider is authenticated: its own CLI sign-in, or an API key held by the runtime. */
  authMethod: z.enum(['cli', 'api-key']).optional(),
  /** Where an API key came from. The key itself is never returned. */
  credential: z.object({ source: z.enum(['stored', 'environment']), hint: z.string() }).nullable().optional(),
  version: z.string().optional(),
  defaultModel: z.string().optional(),
  /** Official documentation for setting the provider up. */
  setupUrl: z.string().optional(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().nullable(),
  createdAt: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

/** Local space for API model chats that are unrelated to a Git repository. */
export const MODEL_CHAT_PROJECT_ID = '00000000-0000-4000-8000-000000000001';

export const SessionStatusSchema = z.enum(['idle', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'interrupted']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export const SessionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  config: AgentConfigSchema,
  status: SessionStatusSchema,
  providerSessionId: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const QueuedMessageSchema = z.object({ id: IdSchema, sessionId: IdSchema, text: z.string().min(1), createdAt: TimestampSchema });
export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

export interface DeveloperActivity {
  github: { connected: boolean; detail: string; repositoryUrl?: string; commits: { sha: string; title: string; author: string; date: string; url: string }[]; pullRequests: { number: number; title: string; url: string; updatedAt: string; state: string }[] };
  vercel: { connected: boolean; detail: string; deployments: { id: string; url: string; state: string; target: string; createdAt: string }[] };
  update: { available: boolean; behind: number; ahead: number; branch: string; blockedReason?: string };
}

export interface IdeUpdateInfo { currentVersion: string; latestVersion: string | null; available: boolean; releaseUrl: string | null; detail: string }

export const TaskSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  prompt: z.string().min(1),
  createdAt: TimestampSchema,
});
export type Task = z.infer<typeof TaskSchema>;
export const TaskRunStatusSchema = z.enum(['queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'interrupted']);
export type TaskRunStatus = z.infer<typeof TaskRunStatusSchema>;
export const TaskRunSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  sessionId: IdSchema,
  status: TaskRunStatusSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  error: z.string().nullable(),
});
export type TaskRun = z.infer<typeof TaskRunSchema>;

export const ApprovalDecisionSchema = z.enum(['approve', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export const ApprovalRequestSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  taskRunId: IdSchema,
  toolName: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'approved', 'denied']),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.nullable(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

const EventBaseSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  taskRunId: IdSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
});
export const AgentEventSchema = z.discriminatedUnion('type', [
  EventBaseSchema.extend({ type: z.literal('message'), role: z.enum(['user', 'assistant']), text: z.string() }),
  EventBaseSchema.extend({ type: z.literal('reasoning_summary'), text: z.string() }),
  EventBaseSchema.extend({ type: z.literal('tool_start'), toolCallId: z.string(), toolName: z.string(), description: z.string() }),
  EventBaseSchema.extend({ type: z.literal('tool_result'), toolCallId: z.string(), toolName: z.string(), output: z.string(), success: z.boolean() }),
  EventBaseSchema.extend({ type: z.literal('approval_requested'), approval: ApprovalRequestSchema }),
  EventBaseSchema.extend({ type: z.literal('approval_resolved'), approvalId: IdSchema, decision: ApprovalDecisionSchema }),
  EventBaseSchema.extend({ type: z.literal('file_changed'), path: z.string(), change: z.enum(['added', 'modified', 'deleted', 'renamed']) }),
  EventBaseSchema.extend({ type: z.literal('error'), code: z.string(), message: z.string() }),
  EventBaseSchema.extend({ type: z.literal('completed'), outcome: z.enum(['completed', 'failed', 'cancelled']), summary: z.string().nullable() }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type NewAgentEvent = AgentEvent extends infer E ? E extends AgentEvent ? Omit<E, 'id' | 'sessionId' | 'taskRunId' | 'sequence' | 'createdAt'> : never : never;

export const ChangedFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export const GitDiffSchema = z.object({
  projectId: IdSchema,
  branch: z.string().nullable(),
  baseRef: z.string().nullable(),
  patch: z.string(),
  files: z.array(ChangedFileSchema),
});
export type GitDiff = z.infer<typeof GitDiffSchema>;

export const RuntimeStatusSchema = z.object({
  state: z.enum(['ready', 'degraded']),
  version: z.string(),
  startedAt: TimestampSchema,
  providers: z.array(ProviderInfoSchema),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof ApiErrorSchema>;
export const GetHealthResponseSchema = RuntimeStatusSchema;
export type GetHealthResponse = z.infer<typeof GetHealthResponseSchema>;
export const GetProvidersResponseSchema = z.object({ providers: z.array(ProviderInfoSchema) });
export type GetProvidersResponse = z.infer<typeof GetProvidersResponseSchema>;
export const GetProjectsResponseSchema = z.object({ projects: z.array(ProjectSchema) });
export type GetProjectsResponse = z.infer<typeof GetProjectsResponseSchema>;
export const CreateProjectRequestSchema = z.object({ path: z.string().min(1), name: z.string().min(1).optional() });
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export const CreateProjectResponseSchema = z.object({ project: ProjectSchema });
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;
export const GetSessionsResponseSchema = z.object({ sessions: z.array(SessionSchema) });
export type GetSessionsResponse = z.infer<typeof GetSessionsResponseSchema>;
export const CreateSessionRequestSchema = z.object({ projectId: IdSchema, config: AgentConfigSchema });
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export const SessionResponseSchema = z.object({ session: SessionSchema });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export const SendMessageRequestSchema = z.object({ text: z.string().min(1) });
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export const SendMessageResponseSchema = z.union([z.object({ task: TaskSchema, run: TaskRunSchema }), z.object({ queued: QueuedMessageSchema })]);
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;
export const GetQueuedMessagesResponseSchema = z.object({ messages: z.array(QueuedMessageSchema) });
export type GetQueuedMessagesResponse = z.infer<typeof GetQueuedMessagesResponseSchema>;
export const CancelSessionResponseSchema = SessionResponseSchema;
export type CancelSessionResponse = z.infer<typeof CancelSessionResponseSchema>;
export const GetSessionEventsResponseSchema = z.object({ events: z.array(AgentEventSchema), nextSequence: z.number().int().nonnegative() });
export type GetSessionEventsResponse = z.infer<typeof GetSessionEventsResponseSchema>;
export const GetSessionDiffResponseSchema = z.object({ diff: GitDiffSchema });
export type GetSessionDiffResponse = z.infer<typeof GetSessionDiffResponseSchema>;
export const ResolveApprovalRequestSchema = z.object({ decision: ApprovalDecisionSchema });
export type ResolveApprovalRequest = z.infer<typeof ResolveApprovalRequestSchema>;
export const ResolveApprovalResponseSchema = z.object({ approval: ApprovalRequestSchema });
export type ResolveApprovalResponse = z.infer<typeof ResolveApprovalResponseSchema>;

export const ModelInfoSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export const GetModelsResponseSchema = z.object({ provider: AgentProviderSchema, models: z.array(ModelInfoSchema) });
export type GetModelsResponse = z.infer<typeof GetModelsResponseSchema>;

/** Stores an API key in the runtime's encrypted store. Only `openai` and `anthropic` accept keys. */
export const SetCredentialRequestSchema = z.object({ apiKey: z.string().trim().min(8).max(500) });
export type SetCredentialRequest = z.infer<typeof SetCredentialRequestSchema>;
export const ProviderResponseSchema = z.object({ provider: ProviderInfoSchema });
export type ProviderResponse = z.infer<typeof ProviderResponseSchema>;

/**
 * Ephemeral streaming text. Deltas are not persisted and carry no sequence:
 * the complete `message` / `reasoning_summary` event that follows is
 * authoritative. SSE sends them as `event: delta` records without an `id`.
 */
export const StreamDeltaSchema = z.object({
  sessionId: IdSchema,
  taskRunId: IdSchema,
  /** Groups the deltas of one streamed message. */
  streamId: z.string(),
  kind: z.enum(['text', 'reasoning']),
  delta: z.string(),
});
export type StreamDelta = z.infer<typeof StreamDeltaSchema>;
export type NewStreamDelta = Omit<StreamDelta, 'sessionId' | 'taskRunId'>;

// ── Web control plane (device pairing) ─────────────────────────────────────

/** What a paired runtime reports to the web control plane on each sync. */
export const DeviceSnapshotSchema = z.object({
  runtimeVersion: z.string(),
  platform: z.enum(['macos', 'windows', 'linux']),
  allowRemoteControl: z.boolean(),
  providers: z.array(ProviderInfoSchema),
  projects: z.array(ProjectSchema),
  sessions: z.array(SessionSchema.extend({ title: z.string().nullable() })),
});
export type DeviceSnapshot = z.infer<typeof DeviceSnapshotSchema>;

export const DeviceCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_session'), projectId: IdSchema, config: AgentConfigSchema, text: z.string().min(1) }),
  z.object({ type: z.literal('send_message'), sessionId: IdSchema, text: z.string().min(1) }),
  z.object({ type: z.literal('cancel'), sessionId: IdSchema }),
  z.object({ type: z.literal('resolve_approval'), approvalId: IdSchema, decision: ApprovalDecisionSchema }),
]);
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>;

export const PairingStatusSchema = z.object({
  paired: z.boolean(),
  controlPlaneUrl: z.string().nullable(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  allowRemoteControl: z.boolean(),
  lastSyncAt: TimestampSchema.nullable(),
  lastError: z.string().nullable(),
});
export type PairingStatus = z.infer<typeof PairingStatusSchema>;
export const PairDeviceRequestSchema = z.object({
  controlPlaneUrl: z.string().url(),
  code: z.string().trim().min(6).max(32),
  deviceName: z.string().trim().min(1).max(80).optional(),
});
export type PairDeviceRequest = z.infer<typeof PairDeviceRequestSchema>;
export const UpdatePairingRequestSchema = z.object({ allowRemoteControl: z.boolean() });
export type UpdatePairingRequest = z.infer<typeof UpdatePairingRequestSchema>;
