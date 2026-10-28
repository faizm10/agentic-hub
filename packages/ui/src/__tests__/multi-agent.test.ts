import { describe, expect, it } from "vitest";
import { buildAgentBrief, validateAssignments, type AgentAssignment } from "../lib/multi-agent";

const rows: AgentAssignment[] = [
  { id: "1", agentId: "claude-code", task: "Build the settings page" },
  { id: "2", agentId: "codex", task: "Write tests for the settings API" },
  { id: "3", agentId: "claude-code", task: "Update the docs" },
];

describe("multi-agent briefs", () => {
  it("gives each agent its own task and tells it what the others do", () => {
    const brief = buildAgentBrief("Ship user settings", rows, 1);
    expect(brief.split("\n")[0]).toBe("Write tests for the settings API");
    expect(brief).toContain("You are Codex, one of 3 agents working in parallel on this goal: Ship user settings");
    expect(brief).toContain("- Claude Code #1: Build the settings page");
    expect(brief).toContain("- Claude Code #2: Update the docs");
    expect(brief).not.toContain("- Codex:");
  });

  it("works without a shared goal", () => {
    expect(buildAgentBrief("", rows, 0)).toContain("\nYou are Claude Code #1, one of 3 agents working in parallel.\n");
  });

  it("requires distinct, non-empty tasks for at least two agents", () => {
    expect(validateAssignments(rows)).toBeNull();
    expect(validateAssignments(rows.slice(0, 1))).toMatch(/at least two/);
    expect(validateAssignments([...rows.slice(0, 2), { id: "4", agentId: "codex", task: " " }])).toMatch(/own task/);
    expect(validateAssignments([rows[0]!, { id: "5", agentId: "codex", task: "build the settings page" }])).toMatch(/same task/);
  });
});
