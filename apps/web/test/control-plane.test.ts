import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRegistry, SessionManager, type AdapterSession, type AgentAdapter } from "@agentic-hub/agent-core";
import { Store } from "@agentic-hub/database";
import type { AgentCapabilities, NewAgentEvent, ProviderInfo } from "@agentic-hub/types";
import { ControlPlaneConnector } from "../../runtime/src/control-plane";
import { POST as pairRoute } from "@/app/api/device/pair/route";
import { POST as syncRoute } from "@/app/api/device/sync/route";
import { createUser } from "@/lib/server/auth";
import { commandStatus, createPairingCode, deviceSessionEvents, listDevices, queueCommand, removeDevice } from "@/lib/server/devices";
import { testDb } from "./helpers";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const capabilities: AgentCapabilities = { execution: true, streaming: true, interactiveMessages: true, approvals: false, cancellation: true, gitDiff: true };
const fakeCodex: AgentAdapter = {
  provider: "codex",
  capabilities,
  readiness: async (): Promise<ProviderInfo> => ({ provider: "codex", displayName: "Codex", capabilities, installed: true, authenticated: true, ready: true }),
  start: async () => {
    let listener: ((e: NewAgentEvent) => void) | null = null;
    const session: AdapterSession = {
      providerSessionId: "thread",
      send: async (text) => listener?.({ type: "message", role: "assistant", text: `echo: ${text}` }),
      subscribe: (cb) => ((listener = cb), () => (listener = null)),
      cancel: async () => {}, resolveApproval: async () => {}, cleanup: async () => {},
    };
    return session;
  },
};

/** Routes the runtime connector's HTTPS calls to this app's real route handlers. */
const toRoutes: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const request = new Request(url, init as RequestInit);
  if (url.pathname === "/api/device/pair") return pairRoute(request);
  if (url.pathname === "/api/device/sync") return syncRoute(request);
  return new Response(null, { status: 404 });
};

describe("device pairing and control plane", () => {
  it("pairs a real runtime, mirrors its sessions, and relays commands only when allowed", async () => {
    const db = await testDb();
    const user = await createUser(db, "dev@example.com", "long enough password");
    const dir = await mkdtemp(join(tmpdir(), "ahub-web-cp-"));
    dirs.push(dir);
    const store = new Store(join(dir, "runtime.db"));
    const registry = new AgentRegistry(0);
    registry.register(fakeCodex);
    const manager = new SessionManager(store, registry);
    const projectId = randomUUID();
    store.putProject({ id: projectId, name: "repo", path: dir, branch: "main", createdAt: new Date().toISOString() });
    const connector = new ControlPlaneConnector(store, registry, manager, toRoutes);

    await expect(connector.pair({ controlPlaneUrl: "https://hub.example.com", code: "ZZZZ-9999" })).rejects.toThrow(/invalid or has expired/);
    const { code } = await createPairingCode(db, user.id);
    const paired = await connector.pair({ controlPlaneUrl: "https://hub.example.com", code: code.toLowerCase(), deviceName: "Studio" });
    connector.stop();
    expect(paired.paired).toBe(true);
    // Codes are single-use.
    await expect(new ControlPlaneConnector(store, registry, manager, toRoutes).pair({ controlPlaneUrl: "https://hub.example.com", code })).rejects.toThrow();

    const session = await manager.create(projectId, { provider: "codex" });
    await manager.send(session.id, "hello");
    await new Promise((r) => setTimeout(r, 30));
    await connector.sync();
    connector.stop();

    const [device] = await listDevices(db, user.id);
    expect(device).toMatchObject({ name: "Studio", online: true, allowRemoteControl: false });
    expect(device!.snapshot!.sessions[0]).toMatchObject({ id: session.id, title: "hello" });
    const events = await deviceSessionEvents(db, user.id, device!.id, session.id);
    expect(events.map((e) => (e.type === "message" ? e.text : e.type))).toEqual(["hello", "echo: hello", "completed"]);

    await expect(queueCommand(db, user.id, device!.id, { type: "send_message", sessionId: session.id, text: "again" })).rejects.toMatchObject({ code: "REMOTE_CONTROL_OFF" });

    connector.update({ allowRemoteControl: true });
    connector.stop();
    await connector.sync();
    connector.stop();
    const { id } = await queueCommand(db, user.id, device!.id, { type: "send_message", sessionId: session.id, text: "again" });
    await connector.sync(); // receives and runs the command
    connector.stop();
    await new Promise((r) => setTimeout(r, 30));
    await connector.sync(); // reports the ack and the new events
    connector.stop();
    expect(await commandStatus(db, user.id, device!.id, id)).toMatchObject({ status: "done" });
    const after = await deviceSessionEvents(db, user.id, device!.id, session.id, 2);
    expect(after.map((e) => (e.type === "message" ? e.text : e.type))).toEqual(["again", "echo: again", "completed"]);

    const created = await queueCommand(db, user.id, device!.id, { type: "create_session", projectId, config: { provider: "codex" }, text: "new task" });
    await connector.sync();
    connector.stop();
    await connector.sync();
    connector.stop();
    const status = await commandStatus(db, user.id, device!.id, created.id);
    expect(status.status).toBe("done");
    expect(typeof status.result?.sessionId).toBe("string");

    // Another account sees nothing.
    const other = await createUser(db, "other@example.com", "long enough password");
    expect(await listDevices(db, other.id)).toEqual([]);
    await expect(deviceSessionEvents(db, other.id, device!.id, session.id)).rejects.toMatchObject({ status: 404 });

    // Revoking the device makes the runtime forget its pairing on the next sync.
    await removeDevice(db, user.id, device!.id);
    await connector.sync();
    connector.stop();
    expect(connector.status()).toMatchObject({ paired: false });
    await manager.close();
    await db.close();
  });
});
