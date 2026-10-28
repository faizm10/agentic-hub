import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../components/chat-composer";
import { TooltipProvider } from "../primitives/tooltip";

const setup = (props: Partial<React.ComponentProps<typeof ChatComposer>> = {}) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <ChatComposer onSubmit={onSubmit} {...props} />
    </TooltipProvider>,
  );
  return { onSubmit, input: screen.getByLabelText("Message the agent") };
};

describe("ChatComposer", () => {
  it("keeps typing and sends queued messages in order while a send is in flight", async () => {
    let release!: () => void;
    const calls: string[] = [];
    const onSubmit = vi.fn((text: string) => {
      calls.push(text);
      return calls.length === 1 ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
    });
    const { input } = setup({ onSubmit, queueWhileRunning: true, running: true });
    await userEvent.type(input, "one{Enter}");
    expect(input).toHaveValue("");
    await userEvent.type(input, "two{Enter}");
    expect(input).toHaveValue("");
    expect(calls).toEqual(["one"]);
    release();
    await vi.waitFor(() => expect(calls).toEqual(["one", "two"]));
  });

  it("restores the draft when sending fails", async () => {
    const { input } = setup({ onSubmit: vi.fn().mockRejectedValue(new Error("offline")) });
    await userEvent.type(input, "keep me{Enter}");
    await vi.waitFor(() => expect(input).toHaveValue("keep me"));
  });

  it("submits trimmed text on Enter and clears", async () => {
    const { onSubmit, input } = setup();
    await userEvent.type(input, "  fix the bug  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("fix the bug");
    expect(input).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const { onSubmit, input } = setup();
    await userEvent.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");
  });

  it("keeps the draft when submission fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("nope"));
    const { input } = setup({ onSubmit });
    await userEvent.type(input, "hello{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(input).toHaveValue("hello");
  });

  it("disables send for empty input", () => {
    setup();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("swaps send for stop while running", async () => {
    const onCancel = vi.fn();
    const { onSubmit, input } = setup({ running: true, onCancel });
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    await userEvent.type(input, "queued?{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Stop run" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("sends a queued message while keeping Stop available", async () => {
    const onCancel = vi.fn();
    const { onSubmit, input } = setup({ running: true, queueWhileRunning: true, onCancel });
    await userEvent.type(input, "next task{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("next task");
    expect(screen.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue message" })).toBeInTheDocument();
  });

  it("explains why input is disabled", () => {
    const { input } = setup({ disabledReason: "Codex isn't ready" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "Codex isn't ready");
  });
});
