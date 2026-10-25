import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown, parseMarkdown } from "../components/markdown";
import { ProviderCard } from "../components/provider-settings";
import { demoAgents } from "../fixtures/data";
import { applySessionEvent, applyStreamDelta, type SessionEvent } from "../model/events";
import type { SessionSnapshot } from "../model/types";

const base: SessionSnapshot = {
  session: { id: "s", projectId: "p", title: "t", agentId: "openai", status: "running", branch: "main", createdAt: "", updatedAt: "", messageCount: 1 },
  timeline: [],
  changes: [],
  tests: [],
  lastSeq: 3,
};
const delta = (text: string, kind: "text" | "reasoning" = "text", streamId = "x") => ({ type: "stream.delta" as const, sessionId: "s", streamId, kind, text, at: "2026-01-01T00:00:00Z" });

describe("stream deltas", () => {
  it("accumulate into a streaming placeholder without advancing the cursor", () => {
    const next = applyStreamDelta(applyStreamDelta(base, delta("Hel")), delta("lo"));
    expect(next.lastSeq).toBe(3);
    expect(next.timeline).toEqual([{ kind: "message", id: "stream:x", role: "assistant", text: "Hello", createdAt: "2026-01-01T00:00:00Z", streaming: true }]);
  });

  it("are replaced by the persisted message", () => {
    const streaming = applyStreamDelta(applyStreamDelta(base, delta("thinking", "reasoning", "r")), delta("Hel"));
    const event: SessionEvent = {
      type: "batch",
      sessionId: "s",
      seq: 4,
      at: "2026-01-01T00:00:01Z",
      events: [
        { type: "message.started", messageId: "m1", role: "assistant" },
        { type: "message.delta", messageId: "m1", text: "Hello" },
        { type: "message.completed", messageId: "m1" },
      ],
    };
    const done = applySessionEvent(streaming, event);
    // The text placeholder is replaced; the reasoning placeholder waits for its own persisted event.
    expect(done.timeline.map((i) => i.id)).toEqual(["stream:r", "m1"]);
    expect(done.timeline.find((i) => i.id === "m1")).toMatchObject({ text: "Hello", streaming: false });
    const finished = applySessionEvent(done, { type: "run.status", status: "completed", sessionId: "s", seq: 5, at: "" });
    expect(finished.timeline.some((i) => i.id.startsWith("stream:"))).toBe(false);
  });
});

describe("Markdown", () => {
  it("parses headings, tables, quotes and open code fences", () => {
    const blocks = parseMarkdown("# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```ts\nconst x = 1;");
    expect(blocks.map((b) => b.type)).toEqual(["h", "table", "quote", "code"]);
    expect(blocks[3]).toMatchObject({ lang: "ts", code: "const x = 1;", open: true });
  });

  it("highlights code, offers copy and never renders unsafe links or raw HTML", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<Markdown source={"[bad](javascript:alert(1)) <img src=x onerror=alert(1)> [ok](https://example.com)\n\n```js\nconst a = '<b>';\n```"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("bad").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "ok" })).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector("pre b")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("const a = '<b>';");
  });
});

describe("ProviderCard API key form", () => {
  const anthropic = demoAgents.find((a) => a.id === "anthropic")!;
  it("submits the key, clears the field, and shows provider errors", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Anthropic rejected the API key.")).mockResolvedValueOnce(undefined);
    render(<ProviderCard agent={anthropic} provider={{ agentId: "anthropic", status: "needs_auth", authMethod: "api-key", availableModels: [] }} apiKey={{ onSave, onClear: vi.fn() }} />);
    const input = screen.getByLabelText("Anthropic API key");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "sk-ant-bad-key-123");
    await userEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("rejected");
    await userEvent.clear(input);
    await userEvent.type(input, "sk-ant-good-key-123");
    await userEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByRole("status")).toHaveTextContent("verified");
    expect(input).toHaveValue("");
    expect(onSave).toHaveBeenLastCalledWith("sk-ant-good-key-123");
  });
});
