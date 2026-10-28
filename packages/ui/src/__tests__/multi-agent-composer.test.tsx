import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MultiAgentComposer, initialAssignments } from "../components/multi-agent-composer";
import type { AgentAssignment } from "../lib/multi-agent";
import type { AgentDescriptor, ProviderConfig } from "../model/types";

const agent = (id: "claude-code" | "codex", name: string): AgentDescriptor =>
  ({ id, name, vendor: "", description: "", kind: "agent", capabilities: { reasoningSummaries: true, toolApprovals: true, modelDiscovery: true, repositoryAccess: true } }) as unknown as AgentDescriptor;
const ready = (agentId: "claude-code" | "codex"): ProviderConfig => ({ agentId, status: "ready", authMethod: "cli-login" }) as ProviderConfig;

function Harness({ onSubmit }: { onSubmit: (rows: AgentAssignment[]) => Promise<void> }) {
  const [rows, setRows] = useState(initialAssignments(["claude-code", "codex"]));
  const [goal, setGoal] = useState("");
  return (
    <MultiAgentComposer
      agents={[agent("claude-code", "Claude Code"), agent("codex", "Codex")]}
      providers={[ready("claude-code"), ready("codex")]}
      assignments={rows}
      onAssignmentsChange={setRows}
      goal={goal}
      onGoalChange={setGoal}
      onSubmit={() => onSubmit(rows)}
    />
  );
}

describe("MultiAgentComposer", () => {
  it("needs a different task for every agent before it can start", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSubmit={onSubmit} />);
    const start = screen.getByRole("button", { name: "Start agents" });
    expect(start).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Task for Claude Code"), "Build the page");
    await userEvent.type(screen.getByLabelText("Task for Codex"), "Build the page");
    expect(start).toBeDisabled();
    expect(screen.getByText(/same task/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Task for Codex"));
    await userEvent.type(screen.getByLabelText("Task for Codex"), "Write the tests");
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ agentId: "claude-code", task: "Build the page" }),
      expect.objectContaining({ agentId: "codex", task: "Write the tests" }),
    ]);
  });

  it("adds another row so the same agent can take a second task", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add agent" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
