import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalRequestCard } from "../components/approval-request-card";
import type { ApprovalItem } from "../model/types";

const item: ApprovalItem = {
  kind: "approval",
  id: "a1",
  tool: "shell",
  title: "Run the test suite",
  command: "pnpm test",
  reason: "Executes project scripts.",
  risk: "medium",
  status: "pending",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("ApprovalRequestCard", () => {
  it("shows the command and sends approve/reject decisions", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalRequestCard item={item} onResolve={onResolve} />);
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByText("medium risk")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onResolve).toHaveBeenCalledWith("approve");
    await userEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onResolve).toHaveBeenLastCalledWith("reject");
  });

  it("surfaces backend errors instead of assuming success", async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error("Approval expired on the runtime"));
    render(<ApprovalRequestCard item={item} onResolve={onResolve} />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Approval expired on the runtime");
  });

  it("disables actions with an explanation when remote approval is unavailable", () => {
    render(<ApprovalRequestCard item={item} onResolve={vi.fn()} unavailableReason="Approve from the desktop app" />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
    expect(screen.getByText("Approve from the desktop app")).toBeInTheDocument();
  });

  it("renders resolved approvals without actions", () => {
    render(<ApprovalRequestCard item={{ ...item, status: "approved" }} onResolve={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });
});
