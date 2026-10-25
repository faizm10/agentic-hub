import type { AgentId } from "./types";

/** Display metadata only. Capabilities and availability come from the client. */
export const AGENT_DISPLAY: Record<AgentId, { name: string; short: string; vendor: string; colorVar: string }> = {
  codex: { name: "Codex", short: "Cx", vendor: "OpenAI", colorVar: "var(--agent-codex)" },
  "claude-code": { name: "Claude Code", short: "Cc", vendor: "Anthropic", colorVar: "var(--agent-claude)" },
  muse: { name: "Muse", short: "Mu", vendor: "Muse", colorVar: "var(--agent-muse)" },
};

export const AGENT_ORDER: AgentId[] = ["codex", "claude-code", "muse"];
