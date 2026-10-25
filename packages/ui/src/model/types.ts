/**
 * Frontend view-model types.
 *
 * PROVISIONAL: these describe what the UI needs to render. They are NOT the
 * shared backend contract (that will live in packages/types, owned by the
 * backend). When the contract commit lands, add adapters in
 * `client/adapters.ts` that map backend types onto these, rather than
 * leaking transport shapes into components.
 */

export type AgentId = "codex" | "claude-code" | "muse" | "openai" | "anthropic";

/** `agent`: a coding agent that works in the repository. `model`: a conversational model API. */
export type AgentKind = "agent" | "model";

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface AgentDescriptor {
  id: AgentId;
  name: string;
  vendor: string;
  description: string;
  kind: AgentKind;
  capabilities: {
    reasoningSummaries: boolean;
    toolApprovals: boolean;
    modelDiscovery: boolean;
    /** Works in the repository: runs tools and changes files. */
    repositoryAccess: boolean;
  };
}

export type ClientMode = "demo" | "live";

export type ConnectionStatus =
  | "demo"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Human-readable explanation, e.g. why the runtime is unavailable. */
  detail?: string;
  /** Epoch ms of the next reconnect attempt, when reconnecting. */
  retryAt?: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string;
  remote?: string;
  lastOpenedAt: string;
  /** Number of uncommitted changed files, when known. */
  uncommittedChanges?: number;
}

export type RunStatus =
  | "idle"
  | "queued"
  | "running"
  | "awaiting_approval"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  /** The runtime restarted mid-turn; a new message is needed to resume. */
  | "interrupted";

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  agentId: AgentId;
  status: RunStatus;
  branch: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type ToolKind = "shell" | "read" | "edit" | "write" | "search" | "web" | "test" | "other";
export type ToolStatus = "running" | "succeeded" | "failed" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalDecision = "approve" | "reject";
export type RiskLevel = "low" | "medium" | "high";

export interface MessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  streaming?: boolean;
}

export interface ReasoningItem {
  kind: "reasoning";
  id: string;
  summary: string;
  createdAt: string;
  streaming?: boolean;
  durationMs?: number;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  tool: ToolKind;
  title: string;
  input?: string;
  output?: string;
  exitCode?: number;
  status: ToolStatus;
  startedAt: string;
  endedAt?: string;
}

export interface ApprovalItem {
  kind: "approval";
  id: string;
  tool: ToolKind;
  title: string;
  reason?: string;
  command?: string;
  paths?: string[];
  /** Only set when the provider reports a risk level; never guessed. */
  risk?: RiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface ErrorItem {
  kind: "error";
  id: string;
  message: string;
  createdAt: string;
  retryable?: boolean;
}

export interface NoticeItem {
  kind: "notice";
  id: string;
  text: string;
  tone: "neutral" | "warning" | "danger" | "success";
  createdAt: string;
}

export type TimelineItem = MessageItem | ReasoningItem | ToolItem | ApprovalItem | ErrorItem | NoticeItem;

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  path: string;
  oldPath?: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileChangeStatus;
  /** Unified diff text for this single file. */
  patch: string;
  binary?: boolean;
  /** Not yet tracked by Git, so there is no patch for it against HEAD. */
  untracked?: boolean;
}

export interface TestRun {
  id: string;
  name: string;
  status: "running" | "passed" | "failed";
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  failures?: { name: string; message: string }[];
}

export interface SessionSnapshot {
  session: SessionSummary;
  timeline: TimelineItem[];
  changes: FileChange[];
  tests: TestRun[];
  /** Sequence number of the last event folded into this snapshot. */
  lastSeq: number;
}

export type ProviderStatus = "ready" | "needs_auth" | "not_installed" | "error" | "unknown";

export interface ProviderConfig {
  agentId: AgentId;
  status: ProviderStatus;
  authMethod: "cli-login" | "api-key" | "none";
  /** For API-key providers: a masked hint of the configured key and where it came from. Never the key. */
  credential?: { source: "stored" | "environment"; hint: string };
  setupUrl?: string;
  executablePath?: string;
  version?: string;
  defaultModel?: string;
  availableModels: string[];
  /** Undefined when the runtime doesn't expose the provider's approval policy. */
  approvalPolicy?: "always" | "untrusted" | "never";
  detail?: string;
}

export type DevicePlatform = "macos" | "windows" | "linux";

export interface Device {
  id: string;
  name: string;
  platform: DevicePlatform;
  status: "online" | "offline";
  lastSeenAt: string;
  runtimeVersion?: string;
  projectCount: number;
  activeSessionCount: number;
}

export interface ActivityEntry {
  id: string;
  at: string;
  deviceId: string;
  sessionId?: string;
  projectName: string;
  agentId?: AgentId;
  text: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface PairingInfo {
  paired: boolean;
  controlPlaneUrl: string | null;
  deviceId: string | null;
  deviceName: string | null;
  allowRemoteControl: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}
