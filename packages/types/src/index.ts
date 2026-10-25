import { z } from 'zod';

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const AgentProviderSchema = z.enum(['codex', 'claude', 'muse']);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const AgentCapabilitiesSchema = z.object({
  execution: z.boolean(),
  streaming: z.boolean(),
  interactiveMessages: z.boolean(),
  approvals: z.boolean(),
  cancellation: z.boolean(),
  gitDiff: z.boolean(),
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
export const SendMessageResponseSchema = z.object({ task: TaskSchema, run: TaskRunSchema });
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;
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
