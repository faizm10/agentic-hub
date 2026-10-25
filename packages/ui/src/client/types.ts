import type { SessionEvent } from "../model/events";
import type {
  ActivityEntry,
  AgentDescriptor,
  AgentId,
  ApprovalDecision,
  ClientMode,
  ConnectionInfo,
  Device,
  FileDiff,
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
  listProviders(): Promise<ProviderConfig[]>;

  listProjects(): Promise<Project[]>;
  /** Register a repository the user picked natively. */
  addProject(path: string): Promise<Project>;

  listSessions(filter?: { projectId?: string }): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  createSession(input: { projectId: string; agentId: AgentId; prompt: string }): Promise<SessionSummary>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  cancelRun(sessionId: string): Promise<void>;
  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
  getDiff(sessionId: string, path: string): Promise<FileDiff>;
  /** Stream session events with seq > `afterSeq`. */
  subscribe(sessionId: string, afterSeq: number, onEvent: (event: SessionEvent) => void): Unsubscribe;

  /** Remote-companion surface (web). */
  listDevices(): Promise<Device[]>;
  listActivity(): Promise<ActivityEntry[]>;
  /**
   * Whether remote actions (start/cancel/approve from web) are permitted.
   * Only an authenticated, authorized control plane may return true.
   */
  remoteActionsAvailable(): boolean;
}
