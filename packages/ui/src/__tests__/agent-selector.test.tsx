import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentSelector } from "../components/agent-selector";
import { demoAgents, demoProviders } from "../fixtures/data";

describe("AgentSelector", () => {
  it("lists agents with provider readiness and changes selection", async () => {
    const onChange = vi.fn();
    render(<AgentSelector agents={demoAgents} providers={demoProviders} value="codex" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Agent: Codex/ }));
    expect(await screen.findByRole("menuitemradio", { name: /Claude Code/ })).toBeInTheDocument();
    expect(screen.getByText("Sign-in required")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Claude Code/ }));
    expect(onChange).toHaveBeenCalledWith("claude-code");
  });
});
