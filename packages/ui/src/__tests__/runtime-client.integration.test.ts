// @vitest-environment node
/**
 * Drives the real runtime HTTP server (SessionManager, encrypted SQLite store,
 * Git diff) through the frontend's runtime client. Only the provider is
 * scripted, so no Codex/Claude login is needed.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry, SessionManager, type AdapterSession, type AgentAdapter } from "@agentic-hub/agent-core";
import { MuseAdapter } from "@agentic-hub/agent-muse";
import { Store } from "@agentic-hub/database";
import { createRuntimeServer } from "@agentic-hub/runtime/dist/server.js";
import { MODEL_CHAT_PROJECT_ID, type AgentCapabilities, type AgentProvider, type ApprovalDecision, type NewAgentEvent, type ProviderInfo } from "@agentic-hub/types";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeClient, RuntimeUnavailableError, type RuntimeClient } from "../client";
import { applySessionEvent, pendingApprovals } from "../model/events";
import type { SessionSnapshot } from "../model/types";

const capabilities: AgentCapabilities = {
  execution: true,
  streaming: true,
  interactiveMessages: true,
  approvals: true,
  cancellation: true,
  gitDiff: true,
};

/** Scripted provider turn: reason, ask approval, edit a file, reply. */
class ScriptedSession implements AdapterSession {
  providerSessionId = "provider-thread";
  private listener: ((event: NewAgentEvent) => void) | null = null;
  private approved: ((decision: ApprovalDecision) => void) | null = null;
  private stop: (() => void) | null = null;
  constructor(
    private readonly repo: string,
    private readonly mode: "approve-and-edit" | "hang",
  ) {}
  subscribe(listener: (event: NewAgentEvent) => void) {
    this.listener = listener;
    return () => (this.listener = null);
  }
  async send(text: string) {
    const emit = (event: NewAgentEvent) => this.listener?.(event);
    if (this.mode === "hang") return new Promise<void>((resolve) => (this.stop = resolve));
    emit({ type: "reasoning_summary", text: `Plan for: ${text}` });
    const toolCallId = randomUUID();
    emit({ type: "tool_start", toolCallId, toolName: "commandExecution", description: "git status" });
    const approvalId = randomUUID();
    const decision = new Promise<ApprovalDecision>((resolve) => (this.approved = resolve));
    emit({
      type: "approval_requested",
      approval: {
        id: approvalId,
        sessionId: "",
        taskRunId: "",
        toolName: "fileChange",
        description: "Edit README.md",
        status: "pending",
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      },
    });
    if ((await decision) === "approve") {
      await writeFile(join(this.repo, "README.md"), "hello\nworld\n");
      emit({ type: "file_changed", path: "README.md", change: "modified" });
    }
    emit({ type: "tool_result", toolCallId, toolName: "commandExecution", output: "ok", success: true });
    emit({ type: "message", role: "assistant", text: "Done." });
  }
  async cancel() {
    this.stop?.();
  }
  async resolveApproval(_id: string, decision: ApprovalDecision) {
    this.approved?.(decision);
  }
  async cleanup() {}
}

class ScriptedAdapter implements AgentAdapter {
  readonly capabilities = capabilities;
  mode: "approve-and-edit" | "hang" = "approve-and-edit";
  constructor(
    readonly provider: AgentProvider,
    private readonly repo: string,
    private readonly ready = true,
  ) {}
  async readiness(): Promise<ProviderInfo> {
    return {
      provider: this.provider,
      displayName: this.provider,
      capabilities,
      installed: true,
      authenticated: this.ready,
      ready: this.ready,
      ...(this.ready ? {} : { reason: "Not signed in" }),
    };
  }
  async start() {
    return new ScriptedSession(this.repo, this.mode);
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "agentic-hub-ui-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "README.md"), "hello\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "init");

  const store = new Store(join(dir, "runtime.db"));
  const codex = new ScriptedAdapter("codex", repo);
  const registry = new AgentRegistry();
  registry.register(codex);
  registry.register(new ScriptedAdapter("claude", repo, false));
  registry.register(new MuseAdapter("/nonexistent/muse"));
  const manager = new SessionManager(store, registry);
  const server = createRuntimeServer(store, registry, manager, "secret-token");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    await manager.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createRuntimeClient({ baseUrl, token: "secret-token" });
  cleanups.push(() => client.dispose());
  return { repo, client, codex };
}

/** Mirror useSessionStream: snapshot first, then fold streamed events. */
async function follow(client: RuntimeClient, sessionId: string) {
  let snapshot = await client.getSession(sessionId);
  const waiters: { test: (s: SessionSnapshot) => boolean; resolve: () => void }[] = [];
  const stop = client.subscribe(sessionId, snapshot.lastSeq, (event) => {
    snapshot = applySessionEvent(snapshot, event);
    for (const waiter of waiters.slice()) {
      if (waiter.test(snapshot)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  });
  cleanups.push(stop);
  const until = (test: (s: SessionSnapshot) => boolean) =>
    test(snapshot)
      ? Promise.resolve(snapshot)
      : new Promise<SessionSnapshot>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timed out; status=${snapshot.session.status} timeline=${JSON.stringify(snapshot.timeline.map((i) => [i.kind, "status" in i ? i.status : ""]))} seq=${snapshot.lastSeq}`)), 3_000);
          waiters.push({ test, resolve: () => (clearTimeout(timer), resolve(snapshot)) });
        });
  return { until, current: () => snapshot };
}

describe("runtime client against the real runtime server", () => {
  it("lists Codex and Claude Code with real readiness", async () => {
    const { client } = await setup();
    const agents = await client.listAgents();
    expect(agents.map((a) => a.id)).toEqual(["codex", "claude-code", "muse"]);
    const providers = await client.listProviders();
    expect(Object.fromEntries(providers.map((p) => [p.agentId, p.status]))).toEqual({
      codex: "ready",
      "claude-code": "needs_auth",
      muse: "not_installed",
    });
    expect(client.getConnection().status).toBe("connected");
  });

  it("creates a session, streams events, resolves an approval and shows the real diff", async () => {
    const { client, repo } = await setup();
    const project = await client.addProject(repo);
    expect(project.branch).toBe("main");
    expect((await client.listProjects()).map((p) => p.id)).toEqual([project.id, MODEL_CHAT_PROJECT_ID]);

    const created = await client.createSession({ projectId: project.id, agentId: "codex", prompt: "Update the readme" });
    expect(created.agentId).toBe("codex");
    expect(created.title).toBe("Update the readme");

    const stream = await follow(client, created.id);
    const waiting = await stream.until((s) => pendingApprovals(s.timeline).length === 1);
    expect(waiting.session.status).toBe("awaiting_approval");
    const [approval] = pendingApprovals(waiting.timeline);
    expect(approval?.title).toBe("Apply file changes");
    expect(approval?.reason).toBe("Edit README.md");

    await client.resolveApproval(created.id, approval!.id, "approve");
    const done = await stream.until((s) => s.session.status === "completed");

    const kinds = done.timeline.map((item) => item.kind);
    expect(kinds).toEqual(["message", "reasoning", "tool", "approval", "message"]);
    expect(done.timeline[0]).toMatchObject({ role: "user", text: "Update the readme", streaming: false });
    expect(done.timeline[2]).toMatchObject({ kind: "tool", tool: "shell", input: "git status", output: "ok", status: "succeeded" });
    expect(done.timeline[3]).toMatchObject({ kind: "approval", status: "approved" });
    expect(done.timeline[4]).toMatchObject({ role: "assistant", text: "Done." });
    expect(done.changes).toEqual([{ path: "README.md", status: "modified", additions: 1, deletions: 0, oldPath: undefined }]);

    const diff = await client.getDiff(created.id, "README.md");
    expect(diff.patch).toContain("+world");
    expect(diff.patch.startsWith("diff --git a/README.md b/README.md")).toBe(true);

    // A fresh snapshot (e.g. after reload) folds the persisted log to the same state.
    const reloaded = await client.getSession(created.id);
    expect(reloaded.timeline).toEqual(done.timeline);
    expect(reloaded.lastSeq).toBe(done.lastSeq);
    const [summary] = await client.listSessions({ projectId: project.id });
    expect(summary).toMatchObject({ id: created.id, title: "Update the readme", status: "completed", messageCount: 2, branch: "main" });

    // Follow-up turn on the same session.
    await client.sendMessage(created.id, "Again");
    const second = await stream.until((s) => pendingApprovals(s.timeline).length === 1);
    await client.resolveApproval(created.id, pendingApprovals(second.timeline)[0]!.id, "reject");
    const after = await stream.until((s) => s.session.status === "completed" && s.timeline.length === 10);
    expect(after.timeline[8]).toMatchObject({ kind: "approval", status: "rejected" });
  });

  it("cancels an active run", async () => {
    const { client, repo, codex } = await setup();
    codex.mode = "hang";
    const project = await client.addProject(repo);
    const created = await client.createSession({ projectId: project.id, agentId: "codex", prompt: "Wait" });
    const stream = await follow(client, created.id);
    await stream.until((s) => s.session.status === "running");
    await client.cancelRun(created.id);
    const done = await stream.until((s) => s.session.status === "cancelled");
    expect(done.timeline.map((i) => i.kind)).toEqual(["message"]);
  });

  it("surfaces runtime errors and provider readiness", async () => {
    const { client, repo } = await setup();
    await expect(client.addProject(join(repo, "missing"))).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    const project = await client.addProject(repo);
    await expect(client.createSession({ projectId: project.id, agentId: "claude-code", prompt: "Hi" })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "Not signed in",
    });
  });

  it("reports a disconnected runtime instead of fabricating data", async () => {
    const client = createRuntimeClient({ baseUrl: "http://127.0.0.1:9", token: "x", retryMs: 60_000 });
    cleanups.push(() => client.dispose());
    await expect(client.listProjects()).rejects.toBeInstanceOf(RuntimeUnavailableError);
    expect(client.getConnection().status).toBe("disconnected");
  });

  it("treats a rejected token as unavailable", async () => {
    const { baseUrl } = await setupBase();
    const client = createRuntimeClient({ baseUrl, token: "wrong", retryMs: 60_000 });
    cleanups.push(() => client.dispose());
    await expect(client.listProjects()).rejects.toBeInstanceOf(RuntimeUnavailableError);
    expect(client.getConnection().detail).toMatch(/token/);
  });
});

async function setupBase() {
  const dir = await mkdtemp(join(tmpdir(), "agentic-hub-ui-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "runtime.db"));
  const registry = new AgentRegistry();
  const manager = new SessionManager(store, registry);
  const server = createRuntimeServer(store, registry, manager, "secret-token");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    await manager.close();
    await new Promise((resolve) => server.close(resolve));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
