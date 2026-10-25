import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionList, groupSessions } from "../components/session-list";
import type { Project, SessionSummary } from "../model/types";

const projects: Project[] = [
  { id: "p1", name: "alpha", path: "/a", branch: "main", lastOpenedAt: "2026-10-20T00:00:00Z" },
  { id: "p2", name: "beta", path: "/b", branch: "main", lastOpenedAt: "2026-10-20T00:00:00Z" },
];
const mk = (id: string, projectId: string, updatedAt: string, title = id): SessionSummary => ({
  id,
  projectId,
  title,
  agentId: "codex",
  status: "completed",
  branch: "main",
  createdAt: updatedAt,
  updatedAt,
  messageCount: 1,
});
const sessions = [
  mk("s1", "p1", "2026-10-20T11:00:00Z", "Fix login"),
  mk("s2", "p2", "2026-10-19T09:00:00Z", "Add caching"),
  mk("s3", "p1", "2026-10-01T09:00:00Z", "Old refactor"),
];

describe("groupSessions", () => {
  it("groups by day bucket in a fixed order", () => {
    const groups = groupSessions(sessions, "date", projects, new Date("2026-10-20T12:00:00Z"));
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["Today", ["s1"]],
      ["Yesterday", ["s2"]],
      ["Older", ["s3"]],
    ]);
  });

  it("groups by project, newest first", () => {
    const groups = groupSessions(sessions, "project", projects);
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["alpha", ["s1", "s3"]],
      ["beta", ["s2"]],
    ]);
  });
});

describe("SessionList", () => {
  it("marks the active session and selects on click", async () => {
    const onSelect = vi.fn();
    render(<SessionList sessions={sessions} projects={projects} activeSessionId="s2" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /Add caching/ })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: /Fix login/ }));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("filters by title", () => {
    render(<SessionList sessions={sessions} projects={projects} filter="cach" />);
    const nav = screen.getByRole("navigation", { name: "Sessions" });
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
  });

  it("shows an empty message when nothing matches", () => {
    render(<SessionList sessions={sessions} projects={projects} filter="zzz" />);
    expect(screen.getByText("No chats match.")).toBeInTheDocument();
  });
});
