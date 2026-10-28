import { AgentMark, Button, RunStatusIndicator } from "@agentic-hub/ui";
import { AGENT_DISPLAY, isRunActive, type SessionSnapshot } from "@agentic-hub/ui/model";
import { BellRing, GitBranch } from "lucide-react";

/** One line describing what the active agent is doing right now, from live session events. */
export function describeActivity(snapshot: SessionSnapshot): string {
  const { session, timeline } = snapshot;
  if (session.status === "awaiting_approval") {
    const approval = [...timeline].reverse().find((item) => item.kind === "approval" && item.status === "pending");
    return approval && approval.kind === "approval" ? `Waiting for you: ${approval.title}` : "Waiting for your approval";
  }
  if (!isRunActive(session.status)) return session.status === "failed" ? "Last run failed" : "Idle";
  const last = [...timeline].reverse().find((item) => item.kind === "tool" || item.kind === "reasoning" || item.kind === "message");
  if (last?.kind === "tool") return last.status === "running" ? `${last.title}${last.input ? `: ${last.input.split("\n")[0]?.slice(0, 80)}` : ""}` : `Finished ${last.title.toLowerCase()}`;
  if (last?.kind === "reasoning") return "Thinking…";
  if (last?.kind === "message" && last.role === "assistant") return "Writing a reply…";
  return "Working…";
}

export function AgentActivityStrip({ snapshot, onOpenChat }: { snapshot: SessionSnapshot; onOpenChat: () => void }) {
  const { session, changes } = snapshot;
  const needsInput = session.status === "awaiting_approval";
  return (
    <div className={needsInput ? "flex items-center gap-2 border-b border-warning/40 bg-warning-soft/60 px-3 py-1.5 text-xs" : "flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs"}>
      <AgentMark agentId={session.agentId} size="sm" />
      <span className="font-medium text-fg">{AGENT_DISPLAY[session.agentId].name}</span>
      <RunStatusIndicator status={session.status} showLabel={false} />
      <span className="min-w-0 flex-1 truncate text-fg-muted">{describeActivity(snapshot)}</span>
      {session.worktree ? (
        <span className="hidden items-center gap-1 font-mono text-fg-subtle sm:inline-flex">
          <GitBranch className="size-3" /> {session.worktree.branch}
        </span>
      ) : null}
      {changes.length ? <span className="text-fg-subtle">{changes.length} file{changes.length === 1 ? "" : "s"} changed</span> : null}
      <Button size="xs" variant={needsInput ? "primary" : "ghost"} onClick={onOpenChat}>
        {needsInput ? (
          <>
            <BellRing /> Review
          </>
        ) : (
          "Open chat"
        )}
      </Button>
    </div>
  );
}
