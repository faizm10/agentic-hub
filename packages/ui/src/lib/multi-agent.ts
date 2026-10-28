import { AGENT_DISPLAY } from "../model/agents";
import type { AgentId } from "../model/types";

export interface AgentAssignment {
  /** Stable row id (the same agent may appear twice with different tasks). */
  id: string;
  agentId: AgentId;
  task: string;
}

const label = (assignments: AgentAssignment[], index: number) => {
  const a = assignments[index]!;
  const name = AGENT_DISPLAY[a.agentId].name;
  const same = assignments.filter((x) => x.agentId === a.agentId);
  return same.length > 1 ? `${name} #${same.indexOf(a) + 1}` : name;
};

/**
 * The prompt one agent receives in a multi-agent run: its own task, the
 * shared goal, and what the others are doing, so agents split the work
 * instead of all doing the same thing.
 */
export function buildAgentBrief(goal: string, assignments: AgentAssignment[], index: number): string {
  const mine = assignments[index]!.task.trim();
  if (assignments.length < 2) return goal.trim() ? `${goal.trim()}\n\n${mine}` : mine;
  const others = assignments
    .map((a, i) => ({ who: label(assignments, i), task: a.task.trim(), i }))
    .filter((o) => o.i !== index)
    .map((o) => `- ${o.who}: ${o.task}`);
  // The task comes first: chat titles are taken from the first line.
  return [
    mine,
    "",
    `You are ${label(assignments, index)}, one of ${assignments.length} agents working in parallel${goal.trim() ? ` on this goal: ${goal.trim()}` : "."}`,
    "The other agents are handling:",
    ...others,
    "",
    "Do only your task. Don't redo or change work that belongs to another agent. When you're done, summarize what you changed.",
  ].join("\n");
}

/** Problems that block starting the run, or null when it can start. */
export function validateAssignments(assignments: AgentAssignment[]): string | null {
  if (assignments.length < 2) return "Add at least two agents.";
  if (assignments.some((a) => !a.task.trim())) return "Give every agent its own task.";
  const tasks = assignments.map((a) => a.task.trim().toLowerCase());
  if (new Set(tasks).size !== tasks.length) return "Two agents have the same task. Give each one a different part of the work.";
  return null;
}
