import type { SessionEvent, StreamDeltaEvent } from "../model/events";
import type { QueuedMessage, DeveloperActivity, IdeUpdateInfo } from "@agentic-hub/types";
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
  createSession(input: { projectId: string; agentId: AgentId; model?: string; prompt: string }): Promise<SessionSummary>;
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
