/**
 * Backend contract adapters: pure functions that map `@agentic-hub/types`
 * (the runtime's v1 API) onto the frontend view model. Transport shapes stop
 * here; components only ever see ../model/types.
 */
import type {
  AgentEvent,
  AgentProvider,
  ApprovalDecision as ContractApprovalDecision,
  ApprovalRequest,
  ChangedFile,
  Project as ContractProject,
  ProviderInfo,
  Session,
  SessionStatus,
} from "@agentic-hub/types";
import { AGENT_DISPLAY } from "../model/agents";
import type { SessionEvent, SessionEventPayload } from "../model/events";
import type {
  AgentDescriptor,
  AgentId,
  ApprovalDecision,
  ApprovalItem,
  FileChange,
  FileDiff,
  Project,
  ProviderConfig,
  RunStatus,
  SessionSummary,
  ToolKind,
} from "../model/types";

// ── Agents and providers ────────────────────────────────────────────────

const AGENT_FOR_PROVIDER: Record<AgentProvider, AgentId> = { codex: "codex", claude: "claude-code", muse: "muse" };
const PROVIDER_FOR_AGENT: Record<AgentId, AgentProvider> = { codex: "codex", "claude-code": "claude", muse: "muse" };

export const toAgentId = (provider: AgentProvider): AgentId => AGENT_FOR_PROVIDER[provider];
export const toProvider = (agentId: AgentId): AgentProvider => PROVIDER_FOR_AGENT[agentId];

/** Static product copy; availability and capabilities come from the runtime. */
const AGENT_DESCRIPTION: Record<AgentId, string> = {
  codex: "OpenAI Codex through its local App Server.",
  "claude-code": "Anthropic Claude Code through the Claude Agent SDK.",
  muse: "Muse Code. The runtime doesn't support running it yet.",
};

export function toAgentDescriptor(info: ProviderInfo): AgentDescriptor {
  const id = toAgentId(info.provider);
  return {
    id,
    name: AGENT_DISPLAY[id].name,
    vendor: AGENT_DISPLAY[id].vendor,
    description: AGENT_DESCRIPTION[id],
    capabilities: {
      // Only the Codex adapter emits reasoning_summary events today.
      reasoningSummaries: info.provider === "codex",
      toolApprovals: info.capabilities.approvals,
    },
  };
}

export function toProviderConfig(info: ProviderInfo): ProviderConfig {
  const status: ProviderConfig["status"] = info.ready
    ? "ready"
    : !info.installed
      ? "not_installed"
      : !info.authenticated
        ? "needs_auth"
        : "error";
  return {
    agentId: toAgentId(info.provider),
    status,
    authMethod: info.provider === "muse" ? "none" : "cli-login",
    availableModels: [],
    detail: info.reason,
  };
}

// ── Projects and sessions ───────────────────────────────────────────────

export function toProject(project: ContractProject): Project {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    branch: project.branch ?? "detached HEAD",
    lastOpenedAt: project.createdAt,
  };
}

export function toRunStatus(status: SessionStatus): RunStatus {
  return status;
}

export function toSessionSummary(
  session: Session,
  extra: { title?: string; branch?: string | null; messageCount?: number } = {},
): SessionSummary {
  const agentId = toAgentId(session.config.provider);
  return {
    id: session.id,
    projectId: session.projectId,
    title: extra.title ?? `${AGENT_DISPLAY[agentId].name} session`,
    agentId,
    status: toRunStatus(session.status),
    branch: extra.branch ?? "detached HEAD",
    model: session.config.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: extra.messageCount ?? 0,
  };
}

/** Title and message count derived from the ordered event log. */
export function summarizeEvents(events: AgentEvent[]): { title?: string; messageCount: number } {
  const messages = events.filter((event) => event.type === "message");
  const first = messages.find((event) => event.role === "user")?.text.trim();
  const title = first ? (first.length > 80 ? `${first.slice(0, 79)}…` : first).split("\n")[0] : undefined;
  return { title, messageCount: messages.length };
}

// ── Approvals ───────────────────────────────────────────────────────────

export const toContractDecision = (decision: ApprovalDecision): ContractApprovalDecision =>
  decision === "approve" ? "approve" : "deny";

export function toToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (name === "bash" || name.includes("command") || name === "shell") return "shell";
  if (name === "read" || name === "notebookread") return "read";
  if (name === "edit" || name === "multiedit" || name === "notebookedit" || name.includes("filechange")) return "edit";
  if (name === "write") return "write";
  if (name === "grep" || name === "glob" || name === "ls") return "search";
  if (name.startsWith("web")) return "web";
  return "other";
}

const APPROVAL_TITLE: Record<string, string> = {
  commandExecution: "Run a command",
  fileChange: "Apply file changes",
};

function toApprovalPayload(approval: ApprovalRequest): Omit<ApprovalItem, "kind" | "status" | "createdAt"> {
  return {
    id: approval.id,
    tool: toToolKind(approval.toolName),
    title: APPROVAL_TITLE[approval.toolName] ?? `Use ${approval.toolName}`,
    // Provider-supplied, untrusted text. It's rendered as plain text, never HTML.
    reason: approval.description,
  };
}

// ── Events ──────────────────────────────────────────────────────────────

/**
 * Map one runtime event (a complete snapshot, not a token delta) to one view
 * event carrying the same sequence number. `extra` lets the caller append
 * updates fetched from other endpoints (e.g. the refreshed changed-file list)
 * so they're de-duplicated together with the event that triggered them.
 */
export function toSessionEvent(event: AgentEvent, extra: SessionEventPayload[] = []): SessionEvent {
  const payloads: SessionEventPayload[] = [];
  switch (event.type) {
    case "message":
      payloads.push(
        { type: "message.started", messageId: event.id, role: event.role },
        { type: "message.delta", messageId: event.id, text: event.text },
        { type: "message.completed", messageId: event.id },
      );
      // The runtime appends the user message as the first event of a new turn.
      if (event.role === "user") payloads.push({ type: "run.status", status: "running" });
      break;
    case "reasoning_summary":
      payloads.push(
        { type: "reasoning.delta", reasoningId: event.id, text: event.text },
        { type: "reasoning.completed", reasoningId: event.id },
      );
      break;
    case "tool_start":
      payloads.push({
        type: "tool.started",
        toolId: event.toolCallId,
        tool: toToolKind(event.toolName),
        title: event.toolName,
        input: event.description !== event.toolName ? event.description : undefined,
      });
      break;
    case "tool_result":
      if (event.output) payloads.push({ type: "tool.output", toolId: event.toolCallId, chunk: event.output });
      payloads.push({ type: "tool.completed", toolId: event.toolCallId, status: event.success ? "succeeded" : "failed" });
      break;
    case "approval_requested":
      payloads.push(
        { type: "approval.requested", approval: toApprovalPayload(event.approval) },
        { type: "run.status", status: "awaiting_approval" },
      );
      break;
    case "approval_resolved":
      payloads.push(
        { type: "approval.resolved", approvalId: event.approvalId, decision: event.decision === "approve" ? "approve" : "reject" },
        { type: "run.status", status: "running" },
      );
      break;
    case "file_changed":
      // The changed-file list itself comes from the diff endpoint via `extra`.
      break;
    case "error":
      payloads.push({ type: "error", message: event.message });
      break;
    case "completed":
      payloads.push({ type: "run.status", status: event.outcome });
      if (event.summary) payloads.push({ type: "notice", text: event.summary, tone: "neutral" });
      break;
  }
  payloads.push(...extra);
  return { type: "batch", events: payloads, sessionId: event.sessionId, seq: event.sequence, at: event.createdAt };
}

/** Events after which the working tree may have changed. */
export const changesWorkingTree = (event: AgentEvent) => event.type === "file_changed" || event.type === "completed";

// ── Git diff ────────────────────────────────────────────────────────────

export function toFileChange(file: ChangedFile): FileChange {
  return {
    path: file.path,
    oldPath: file.oldPath ?? undefined,
    status: file.status === "untracked" ? "added" : file.status,
    additions: file.additions,
    deletions: file.deletions,
  };
}

const DIFF_HEADER = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/;

/** Split a multi-file `git diff` into per-file patches keyed by new path. */
export function splitPatch(patch: string): Map<string, string> {
  const files = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (path != null) files.set(path, lines.join("\n"));
  };
  for (const line of patch.split("\n")) {
    const match = DIFF_HEADER.exec(line);
    if (match) {
      flush();
      path = match[2] ?? match[1] ?? null;
      lines = [line];
    } else if (path != null) {
      lines.push(line);
    }
  }
  flush();
  return files;
}

export function toFileDiff(file: ChangedFile, patch: string | undefined): FileDiff {
  const text = patch ?? "";
  return {
    path: file.path,
    oldPath: file.oldPath ?? undefined,
    status: file.status === "untracked" ? "added" : file.status,
    patch: text,
    binary: /^(?:GIT binary patch|Binary files )/m.test(text) || undefined,
    untracked: file.status === "untracked" || undefined,
  };
}
