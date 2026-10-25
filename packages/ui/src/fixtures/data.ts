/**
 * DEMO FIXTURES. Everything in this file is illustrative sample data for
 * demo mode. It is never shown without the demo-mode label and is never
 * used by live clients.
 */
import type {
  ActivityEntry,
  AgentDescriptor,
  Device,
  FileDiff,
  Project,
  ProviderConfig,
  SessionSnapshot,
  SessionSummary,
  TimelineItem,
} from "../model/types";

const now = Date.now();
export const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const demoAgents: AgentDescriptor[] = [
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    description: "Fast, terminal-native edits with sandboxed command execution.",
    capabilities: { reasoningSummaries: true, toolApprovals: true },
  },
  {
    id: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    description: "Deep repository reasoning, multi-file refactors and planning.",
    capabilities: { reasoningSummaries: true, toolApprovals: true },
  },
  {
    id: "muse",
    name: "Muse",
    vendor: "Muse",
    description: "Lightweight assistant for quick questions and small changes.",
    capabilities: { reasoningSummaries: false, toolApprovals: true },
  },
];

export const demoProviders: ProviderConfig[] = [
  {
    agentId: "codex",
    status: "ready",
    authMethod: "cli-login",
    executablePath: "/opt/homebrew/bin/codex",
    version: "demo",
    defaultModel: "gpt-5-codex",
    availableModels: ["gpt-5-codex", "gpt-5"],
    approvalPolicy: "untrusted",
  },
  {
    agentId: "claude-code",
    status: "ready",
    authMethod: "cli-login",
    executablePath: "~/.local/bin/claude",
    version: "demo",
    defaultModel: "claude-opus-5-5",
    availableModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
    approvalPolicy: "untrusted",
  },
  {
    agentId: "muse",
    status: "needs_auth",
    authMethod: "api-key",
    availableModels: [],
    approvalPolicy: "always",
    detail: "Sign in with the Muse CLI on this machine. Keys are stored by the runtime, never in the app.",
  },
];

export const demoProjects: Project[] = [
  {
    id: "p-hub",
    name: "agentic-hub",
    path: "~/code/agentic-hub",
    branch: "feat/frontend",
    remote: "github.com/acme/agentic-hub",
    lastOpenedAt: ago(4),
    uncommittedChanges: 3,
  },
  {
    id: "p-pay",
    name: "payments-service",
    path: "~/code/payments-service",
    branch: "main",
    remote: "github.com/acme/payments-service",
    lastOpenedAt: ago(60 * 26),
    uncommittedChanges: 0,
  },
  {
    id: "p-docs",
    name: "docs-site",
    path: "~/code/docs-site",
    branch: "content/q4-guides",
    lastOpenedAt: ago(60 * 24 * 5),
  },
];

const s = (session: Omit<SessionSummary, "messageCount"> & { messageCount?: number }): SessionSummary => ({
  messageCount: 2,
  ...session,
});

export const demoSessions: SessionSummary[] = [
  s({
    id: "s-retry",
    projectId: "p-hub",
    title: "Add retry with backoff to webhook dispatcher",
    agentId: "claude-code",
    status: "awaiting_approval",
    branch: "feat/frontend",
    model: "claude-opus-5-5",
    createdAt: ago(18),
    updatedAt: ago(2),
    messageCount: 3,
  }),
  s({
    id: "s-flaky",
    projectId: "p-hub",
    title: "Fix flaky session-list test",
    agentId: "codex",
    status: "completed",
    branch: "feat/frontend",
    model: "gpt-5-codex",
    createdAt: ago(95),
    updatedAt: ago(80),
  }),
  s({
    id: "s-theme",
    projectId: "p-hub",
    title: "Explain how theme tokens are wired",
    agentId: "muse",
    status: "completed",
    branch: "feat/frontend",
    createdAt: ago(60 * 27),
    updatedAt: ago(60 * 27 - 3),
  }),
  s({
    id: "s-idem",
    projectId: "p-pay",
    title: "Idempotency keys for refund endpoint",
    agentId: "codex",
    status: "failed",
    branch: "main",
    model: "gpt-5-codex",
    createdAt: ago(60 * 26),
    updatedAt: ago(60 * 25.5),
  }),
  s({
    id: "s-ledger",
    projectId: "p-pay",
    title: "Audit ledger rounding",
    agentId: "claude-code",
    status: "cancelled",
    branch: "main",
    model: "claude-sonnet-5-5",
    createdAt: ago(60 * 24 * 3),
    updatedAt: ago(60 * 24 * 3 - 6),
  }),
  s({
    id: "s-guides",
    projectId: "p-docs",
    title: "Draft quickstart for CLI login",
    agentId: "claude-code",
    status: "completed",
    branch: "content/q4-guides",
    createdAt: ago(60 * 24 * 5),
    updatedAt: ago(60 * 24 * 5 - 12),
  }),
];

const retryPatch = `@@ -1,18 +1,34 @@
 import { signPayload } from "./signing";
+import { sleep } from "../util/sleep";
 import type { WebhookTarget } from "./types";

+const MAX_ATTEMPTS = 5;
+const BASE_DELAY_MS = 250;
+
 export async function dispatch(target: WebhookTarget, body: unknown) {
   const payload = JSON.stringify(body);
-  const response = await fetch(target.url, {
-    method: "POST",
-    headers: {
-      "content-type": "application/json",
-      "x-signature": signPayload(payload, target.secret),
-    },
-    body: payload,
-  });
-  if (!response.ok) {
-    throw new Error(\`Webhook failed: \${response.status}\`);
+  let lastError: unknown;
+
+  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
+    try {
+      const response = await fetch(target.url, {
+        method: "POST",
+        headers: {
+          "content-type": "application/json",
+          "x-signature": signPayload(payload, target.secret),
+          "x-attempt": String(attempt),
+        },
+        body: payload,
+      });
+      if (response.ok) return response;
+      if (response.status < 500 && response.status !== 429) {
+        throw new Error(\`Webhook rejected: \${response.status}\`);
+      }
+      lastError = new Error(\`Webhook failed: \${response.status}\`);
+    } catch (error) {
+      lastError = error;
+    }
+    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
   }
-  return response;
+  throw lastError;
 }
`;

const sleepPatch = `@@ -0,0 +1,3 @@
+export function sleep(ms: number) {
+  return new Promise<void>((resolve) => setTimeout(resolve, ms));
+}
`;

const testPatch = `@@ -12,6 +12,24 @@ describe("dispatch", () => {
     expect(fetchMock).toHaveBeenCalledOnce();
   });

+  it("retries 5xx responses with backoff", async () => {
+    fetchMock
+      .mockResolvedValueOnce(new Response(null, { status: 503 }))
+      .mockResolvedValueOnce(new Response(null, { status: 200 }));
+
+    await dispatch(target, { ok: true });
+
+    expect(fetchMock).toHaveBeenCalledTimes(2);
+    expect(sleepMock).toHaveBeenCalledWith(250);
+  });
+
+  it("does not retry 4xx responses", async () => {
+    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
+
+    await expect(dispatch(target, {})).rejects.toThrow("rejected: 400");
+    expect(fetchMock).toHaveBeenCalledOnce();
+  });
+
   it("signs the payload", async () => {
     await dispatch(target, { id: 1 });
     const [, init] = fetchMock.mock.calls[0]!;
`;

const flakyPatch = `@@ -21,9 +21,11 @@ it("groups sessions by day", async () => {
-  const now = new Date();
+  vi.useFakeTimers();
+  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
   render(<SessionList sessions={fixtures} />);
-  expect(await screen.findByText("Today")).toBeInTheDocument();
+  expect(screen.getByText("Today")).toBeInTheDocument();
   expect(screen.getByText("Yesterday")).toBeInTheDocument();
+  vi.useRealTimers();
 });
`;

export const demoDiffs: Record<string, FileDiff[]> = {
  "s-retry": [
    { path: "src/webhooks/dispatch.ts", status: "modified", patch: retryPatch },
    { path: "src/util/sleep.ts", status: "added", patch: sleepPatch },
    { path: "src/webhooks/dispatch.test.ts", status: "modified", patch: testPatch },
  ],
  "s-flaky": [{ path: "packages/ui/src/components/session-list.test.tsx", status: "modified", patch: flakyPatch }],
};

function countPatch(patch: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

export function changesFor(sessionId: string) {
  return (demoDiffs[sessionId] ?? []).map((d) => ({ path: d.path, status: d.status, ...countPatch(d.patch) }));
}

const retryTimeline: TimelineItem[] = [
  {
    kind: "message",
    id: "m1",
    role: "user",
    createdAt: ago(18),
    text: "Webhook deliveries sometimes fail on transient 503s. Add retry with exponential backoff to the dispatcher — don't retry 4xx except 429 — and cover it with tests.",
  },
  {
    kind: "reasoning",
    id: "r1",
    createdAt: ago(17.9),
    durationMs: 4200,
    summary:
      "The dispatcher is a single fetch call with no retry. I'll wrap it in a bounded loop, classify responses as retryable (5xx, 429, network errors) or terminal (other 4xx), and inject `sleep` so tests can assert delays without waiting.",
  },
  {
    kind: "tool",
    id: "t1",
    tool: "search",
    title: "Search for dispatch callers",
    input: 'rg -n "dispatch\\(" src',
    output:
      "src/webhooks/dispatch.ts:5:export async function dispatch(target: WebhookTarget, body: unknown) {\nsrc/webhooks/queue.ts:41:      await dispatch(job.target, job.body);\nsrc/webhooks/dispatch.test.ts:9:    await dispatch(target, { ok: true });",
    status: "succeeded",
    exitCode: 0,
    startedAt: ago(17.8),
    endedAt: ago(17.79),
  },
  {
    kind: "tool",
    id: "t2",
    tool: "read",
    title: "Read src/webhooks/dispatch.ts",
    input: "src/webhooks/dispatch.ts",
    status: "succeeded",
    startedAt: ago(17.7),
    endedAt: ago(17.69),
  },
  {
    kind: "tool",
    id: "t3",
    tool: "edit",
    title: "Edit src/webhooks/dispatch.ts",
    input: "src/webhooks/dispatch.ts (+26 −10)",
    status: "succeeded",
    startedAt: ago(17),
    endedAt: ago(16.9),
  },
  {
    kind: "tool",
    id: "t4",
    tool: "write",
    title: "Create src/util/sleep.ts",
    input: "src/util/sleep.ts (+3)",
    status: "succeeded",
    startedAt: ago(16.8),
    endedAt: ago(16.79),
  },
  {
    kind: "tool",
    id: "t5",
    tool: "edit",
    title: "Edit src/webhooks/dispatch.test.ts",
    input: "src/webhooks/dispatch.test.ts (+18)",
    status: "succeeded",
    startedAt: ago(16.5),
    endedAt: ago(16.4),
  },
  {
    kind: "message",
    id: "m2",
    role: "assistant",
    createdAt: ago(16),
    text: "I've added a bounded retry loop to `dispatch`:\n\n- **Retryable:** 5xx, `429`, and network errors — up to 5 attempts with exponential backoff (250ms base).\n- **Terminal:** any other 4xx throws immediately.\n- Each request carries an `x-attempt` header so receivers can de-duplicate.\n\nI also added two tests. I'd like to run the webhook test suite to confirm.",
  },
  {
    kind: "approval",
    id: "a1",
    tool: "shell",
    title: "Run the webhook test suite",
    command: "pnpm vitest run src/webhooks",
    reason: "Executes project scripts from package.json in the repository.",
    risk: "medium",
    status: "pending",
    createdAt: ago(2),
  },
];

const flakyTimeline: TimelineItem[] = [
  {
    kind: "message",
    id: "m1",
    role: "user",
    createdAt: ago(95),
    text: "session-list.test.tsx fails around midnight in CI. Can you make it deterministic?",
  },
  {
    kind: "reasoning",
    id: "r1",
    createdAt: ago(94.8),
    durationMs: 2100,
    summary: "The test uses the real clock, so the “Today” bucket depends on when CI runs. Pin the system time with fake timers.",
  },
  {
    kind: "tool",
    id: "t1",
    tool: "edit",
    title: "Edit session-list.test.tsx",
    input: "packages/ui/src/components/session-list.test.tsx (+4 −2)",
    status: "succeeded",
    startedAt: ago(94),
    endedAt: ago(93.9),
  },
  {
    kind: "tool",
    id: "t2",
    tool: "test",
    title: "Run session-list tests",
    input: "pnpm vitest run session-list",
    output: " ✓ src/components/session-list.test.tsx (6 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)",
    exitCode: 0,
    status: "succeeded",
    startedAt: ago(93),
    endedAt: ago(92.9),
  },
  {
    kind: "message",
    id: "m2",
    role: "assistant",
    createdAt: ago(92),
    text: "Pinned the clock with `vi.setSystemTime` so date bucketing no longer depends on when CI runs. All 6 tests pass locally.",
  },
];

const idemTimeline: TimelineItem[] = [
  {
    kind: "message",
    id: "m1",
    role: "user",
    createdAt: ago(60 * 26),
    text: "Add idempotency-key support to POST /refunds.",
  },
  {
    kind: "tool",
    id: "t1",
    tool: "shell",
    title: "Run migrations",
    input: "pnpm db:migrate",
    output: "Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete]",
    exitCode: 1,
    status: "failed",
    startedAt: ago(60 * 25.8),
    endedAt: ago(60 * 25.8),
  },
  {
    kind: "error",
    id: "e1",
    createdAt: ago(60 * 25.5),
    message: "Run stopped: the local database is not reachable (ECONNREFUSED 127.0.0.1:5432).",
    retryable: true,
  },
];

const themeTimeline: TimelineItem[] = [
  { kind: "message", id: "m1", role: "user", createdAt: ago(60 * 27), text: "How are the theme tokens wired between Tailwind and the components?" },
  {
    kind: "message",
    id: "m2",
    role: "assistant",
    createdAt: ago(60 * 27 - 1),
    text: "Tokens are CSS variables on `:root` and `[data-theme=dark]` in `tokens.css`. An `@theme inline` block maps them to Tailwind colors, so `bg-surface` resolves to `var(--surface)` and flips with the theme attribute without rebuilding classes.",
  },
];

function snapshot(id: string, timeline: TimelineItem[], tests: SessionSnapshot["tests"] = []): SessionSnapshot {
  const session = demoSessions.find((x) => x.id === id)!;
  return { session, timeline, changes: changesFor(id), tests, lastSeq: 0 };
}

export const demoSnapshots: Record<string, SessionSnapshot> = {
  "s-retry": snapshot("s-retry", retryTimeline),
  "s-flaky": snapshot("s-flaky", flakyTimeline, [
    { id: "tr1", name: "vitest · session-list", status: "passed", passed: 6, failed: 0, skipped: 0, durationMs: 410 },
  ]),
  "s-theme": snapshot("s-theme", themeTimeline),
  "s-idem": snapshot("s-idem", idemTimeline, [
    {
      id: "tr1",
      name: "vitest · refunds",
      status: "failed",
      passed: 11,
      failed: 2,
      skipped: 1,
      durationMs: 2300,
      failures: [
        { name: "refunds › replays stored response for duplicate key", message: "ECONNREFUSED 127.0.0.1:5432" },
        { name: "refunds › rejects key reuse with different body", message: "ECONNREFUSED 127.0.0.1:5432" },
      ],
    },
  ]),
  "s-ledger": snapshot("s-ledger", [
    { kind: "message", id: "m1", role: "user", createdAt: ago(60 * 72), text: "Audit ledger rounding for multi-currency refunds." },
    { kind: "notice", id: "n1", tone: "warning", createdAt: ago(60 * 72 - 6), text: "Run cancelled by user." },
  ]),
  "s-guides": snapshot("s-guides", [
    { kind: "message", id: "m1", role: "user", createdAt: ago(60 * 120), text: "Draft a quickstart for logging into the CLI." },
    { kind: "message", id: "m2", role: "assistant", createdAt: ago(60 * 120 - 12), text: "Drafted `guides/cli-login.mdx` with install, `login`, and verification steps." },
  ]),
};

export const demoDevices: Device[] = [
  {
    id: "d-mbp",
    name: "Studio MacBook Pro",
    platform: "macos",
    status: "online",
    lastSeenAt: ago(0.5),
    runtimeVersion: "demo",
    projectCount: 3,
    activeSessionCount: 1,
  },
  {
    id: "d-linux",
    name: "build-box (Ubuntu)",
    platform: "linux",
    status: "offline",
    lastSeenAt: ago(60 * 9),
    runtimeVersion: "demo",
    projectCount: 1,
    activeSessionCount: 0,
  },
];

export const demoActivity: ActivityEntry[] = [
  { id: "ac1", at: ago(2), deviceId: "d-mbp", sessionId: "s-retry", projectName: "agentic-hub", agentId: "claude-code", text: "Waiting for approval: run the webhook test suite", tone: "warning" },
  { id: "ac2", at: ago(80), deviceId: "d-mbp", sessionId: "s-flaky", projectName: "agentic-hub", agentId: "codex", text: "Session completed · 1 file changed", tone: "success" },
  { id: "ac3", at: ago(60 * 25.5), deviceId: "d-mbp", sessionId: "s-idem", projectName: "payments-service", agentId: "codex", text: "Run failed: database not reachable", tone: "danger" },
  { id: "ac4", at: ago(60 * 9), deviceId: "d-linux", projectName: "build-box (Ubuntu)", text: "Device went offline", tone: "neutral" },
];
