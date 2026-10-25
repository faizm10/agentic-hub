import type { AgentEvent, ProviderInfo } from "@agentic-hub/types";
import { describe, expect, it } from "vitest";
import { splitPatch, toFileDiff, toProviderConfig, toSessionEvent, toToolKind } from "../client/adapters";
import { readServerSentEvents } from "../client/runtime-client";
import { applySessionEvent } from "../model/events";
import type { SessionSnapshot } from "../model/types";

const caps = { execution: true, streaming: true, interactiveMessages: true, approvals: true, cancellation: true, gitDiff: true };
const info = (over: Partial<ProviderInfo>): ProviderInfo => ({
  provider: "claude",
  displayName: "Claude Code",
  capabilities: caps,
  installed: true,
  authenticated: true,
  ready: true,
  ...over,
});

describe("contract adapters", () => {
  it("maps provider readiness without inventing settings", () => {
    expect(toProviderConfig(info({}))).toMatchObject({ agentId: "claude-code", status: "ready", availableModels: [] });
    expect(toProviderConfig(info({ ready: false, authenticated: false, reason: "Not signed in" }))).toMatchObject({
      status: "needs_auth",
      detail: "Not signed in",
    });
    expect(toProviderConfig(info({ ready: false, installed: false, authenticated: false })).status).toBe("not_installed");
    expect(toProviderConfig(info({})).approvalPolicy).toBeUndefined();
  });

  it("splits a multi-file git diff per file", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/img.png b/img.png",
      "GIT binary patch",
      "",
    ].join("\n");
    const files = splitPatch(patch);
    expect([...files.keys()]).toEqual(["a.ts", "img.png"]);
    expect(files.get("a.ts")).toContain("+y");
    expect(files.get("a.ts")).not.toContain("img.png");
    const binary = toFileDiff({ path: "img.png", oldPath: null, status: "modified", additions: 0, deletions: 0 }, files.get("img.png"));
    expect(binary.binary).toBe(true);
    const untracked = toFileDiff({ path: "new.ts", oldPath: null, status: "untracked", additions: 0, deletions: 0 }, undefined);
    expect(untracked).toMatchObject({ status: "added", untracked: true, patch: "" });
  });

  it("classifies tools from Codex and Claude names", () => {
    expect(toToolKind("Bash")).toBe("shell");
    expect(toToolKind("commandExecution")).toBe("shell");
    expect(toToolKind("fileChange")).toBe("edit");
    expect(toToolKind("Grep")).toBe("search");
    expect(toToolKind("mcp__thing")).toBe("other");
  });

  it("folds a snapshot event once, even when replayed", () => {
    const event: AgentEvent = {
      type: "message",
      role: "assistant",
      text: "hi",
      id: "e1",
      sessionId: "s",
      taskRunId: "r",
      sequence: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const initial: SessionSnapshot = {
      session: {
        id: "s",
        projectId: "p",
        title: "t",
        agentId: "codex",
        status: "running",
        branch: "main",
        createdAt: "",
        updatedAt: "",
        messageCount: 0,
      },
      timeline: [],
      changes: [],
      tests: [],
      lastSeq: -1,
    };
    const once = applySessionEvent(initial, toSessionEvent(event));
    const twice = applySessionEvent(once, toSessionEvent(event));
    expect(twice).toBe(once);
    expect(once.timeline).toEqual([
      { kind: "message", id: "e1", role: "assistant", text: "hi", createdAt: event.createdAt, streaming: false },
    ]);
    expect(once.lastSeq).toBe(3);
  });

  it("parses SSE records split across chunks and skips heartbeats", async () => {
    const chunks = [": heartbeat\n\nid: 0\nevent: mess", 'age\ndata: {"a":1}\n\nid: 1\ndata: {"b":2}\r\n\r\n'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const records = [];
    for await (const record of readServerSentEvents(body)) records.push(record);
    expect(records).toEqual([
      { id: "0", event: "message", data: '{"a":1}' },
      { id: "1", event: "message", data: '{"b":2}' },
    ]);
  });
});
