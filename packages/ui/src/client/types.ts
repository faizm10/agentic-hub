import type { SessionEvent, StreamDeltaEvent } from "../model/events";
import type {
  ApprovalPolicy,
  DeveloperActivity,
  EnvironmentReport,
  FileContent,
  FileEntry,
  GitHubOverview,
  GitHubRepoSummary,
  IdeUpdateInfo,
  IntegrationAction,
  IntegrationStatus,
  Job,
  QueuedMessage,
  UsageReport,
  VercelOverview,
} from "@agentic-hub/types";
import type {
  ActivityEntry,
  AgentDescriptor,
  AgentId,
  ApprovalDecision,
  ClientMode,
  ConnectionInfo,
  Device,
  FileDiff,
  ModelOption,
  PairingInfo,
  Project,
  ProviderConfig,
  SessionSnapshot,
  SessionSummary,
} from "../model/types";

export type Unsubscribe = () => void;

/**
 * The single boundary between UI and any backend. Components never call
 * fetch/invoke directly; they go through an implementation of this
 * interface (demo fixtures today, the real runtime client once the shared
 * contract lands).
 */
export interface AgentHubClient {
  readonly mode: ClientMode;
  /** Short label for UI, e.g. "Demo fixtures" or "Local runtime". */
  readonly label: string;

  getConnection(): ConnectionInfo;
  onConnectionChange(listener: (info: ConnectionInfo) => void): Unsubscribe;
  /** Ask the client to retry its connection immediately. */
  reconnect(): void;

  listAgents(): Promise<AgentDescriptor[]>;
  /** `refresh` re-runs CLI detection instead of using the runtime's short cache. */
  listProviders(options?: { refresh?: boolean }): Promise<ProviderConfig[]>;
  /** Models the provider currently offers. Rejects when discovery is unsupported or the provider isn't ready. */
  listModels(agentId: AgentId): Promise<ModelOption[]>;
  /** Saves an API key in the runtime's encrypted store after the provider accepts it. The key is never returned. */
  setApiKey(agentId: AgentId, apiKey: string): Promise<ProviderConfig>;
  clearApiKey(agentId: AgentId): Promise<ProviderConfig>;

  listProjects(): Promise<Project[]>;
  /** Register a repository the user picked natively. */
  addProject(path: string): Promise<Project>;

  listSessions(filter?: { projectId?: string }): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  /** `isolation: "worktree"` runs the agent on a new branch in its own Git worktree. */
  createSession(input: { projectId: string; agentId: AgentId; model?: string; prompt: string; isolation?: "none" | "worktree"; groupId?: string }): Promise<SessionSummary>;
  /** Token usage reports, one per source (this computer, web chats, each paired computer). */
  getUsage(options?: { days?: number }): Promise<UsageReport[]>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  listQueuedMessages(sessionId: string): Promise<QueuedMessage[]>;
  removeQueuedMessage(sessionId: string, messageId: string): Promise<void>;
  getAutoApprove(): Promise<boolean>;
  setAutoApprove(enabled: boolean): Promise<boolean>;
  getDeveloperActivity(projectId: string): Promise<DeveloperActivity>;
  updateRepository(projectId: string): Promise<void>;
  getIdeUpdate(): Promise<IdeUpdateInfo>;
  openIdeUpdate(): Promise<void>;
  cancelRun(sessionId: string): Promise<void>;

  // ── Workspace (desktop runtime only; other clients reject) ──
  getEnvironment(options?: { refresh?: boolean }): Promise<EnvironmentReport>;
  getApprovalPolicy(): Promise<ApprovalPolicy>;
  setApprovalPolicy(policy: ApprovalPolicy): Promise<ApprovalPolicy>;
  listIntegrations(): Promise<IntegrationStatus[]>;
  listGitHubRepositories(): Promise<GitHubRepoSummary[]>;
  /** Clones a GitHub repository (owner/name or URL) and registers it. */
  cloneRepository(repository: string, directory?: string): Promise<Project>;
  /** `sessionId` scopes file and Git operations to that session's worktree. */
  listFiles(projectId: string, path: string, sessionId?: string): Promise<FileEntry[]>;
  readFile(projectId: string, path: string, sessionId?: string): Promise<FileContent>;
  writeFile(projectId: string, path: string, content: string, sessionId?: string): Promise<FileContent>;
  runCommand(projectId: string, command: string, sessionId?: string): Promise<Job>;
  listJobs(projectId?: string): Promise<Job[]>;
  getJob(jobId: string): Promise<Job>;
  cancelJob(jobId: string): Promise<void>;
  /** Live output of a running job; `onDone` receives the final job. */
  streamJob(jobId: string, handlers: { onOutput(chunk: string): void; onDone(job: Job): void; onError?(error: unknown): void }): Unsubscribe;
  getGitHubOverview(projectId: string, sessionId?: string): Promise<GitHubOverview>;
  getVercelOverview(projectId: string, sessionId?: string): Promise<VercelOverview>;
  /** Non-low-risk actions reject with code `CONFIRMATION_REQUIRED` unless `confirm` is set. */
  runIntegrationAction(projectId: string, input: IntegrationAction, options?: { confirm?: boolean; sessionId?: string }): Promise<Job>;
  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
  getDiff(sessionId: string, path: string): Promise<FileDiff>;
  /** Stream session events with seq > `afterSeq`. */
  subscribe(
    sessionId: string,
    afterSeq: number,
    onEvent: (event: SessionEvent) => void,
    onDelta?: (delta: StreamDeltaEvent) => void,
  ): Unsubscribe;

  /** Web control-plane pairing for this runtime (desktop only). */
  getPairing(): Promise<PairingInfo>;
  pair(input: { controlPlaneUrl: string; code: string; deviceName?: string }): Promise<PairingInfo>;
  updatePairing(input: { allowRemoteControl: boolean }): Promise<PairingInfo>;
  unpair(): Promise<PairingInfo>;

  /** Remote-companion surface (web). */
  listDevices(): Promise<Device[]>;
  listActivity(): Promise<ActivityEntry[]>;
  /**
   * Whether remote actions (start/cancel/approve from web) are permitted.
   * Only an authenticated, authorized control plane may return true.
   */
  remoteActionsAvailable(): boolean;
}
