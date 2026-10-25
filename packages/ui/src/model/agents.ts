import type { AgentId, AgentKind } from "./types";

/** Display metadata only. Capabilities and availability come from the client. */
export const AGENT_DISPLAY: Record<AgentId, { name: string; short: string; vendor: string; colorVar: string; kind: AgentKind }> = {
  codex: { name: "Codex", short: "Cx", vendor: "OpenAI", colorVar: "var(--agent-codex)", kind: "agent" },
  "claude-code": { name: "Claude Code", short: "Cc", vendor: "Anthropic", colorVar: "var(--agent-claude)", kind: "agent" },
  muse: { name: "Muse Code", short: "Mu", vendor: "Meta", colorVar: "var(--agent-muse)", kind: "agent" },
  openai: { name: "OpenAI", short: "Ai", vendor: "OpenAI API", colorVar: "var(--agent-openai)", kind: "model" },
  anthropic: { name: "Anthropic", short: "An", vendor: "Anthropic API", colorVar: "var(--agent-anthropic)", kind: "model" },
};

/** Coding agents first, then model APIs. ⌘1–5 follows this order. */
export const AGENT_ORDER: AgentId[] = ["codex", "claude-code", "muse", "openai", "anthropic"];
