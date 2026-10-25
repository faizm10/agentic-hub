import { describe, expect, it } from "vitest";
import type { ReplyStream } from "@agentic-hub/agent-api/providers";
import { createUser, rateLimit, signupAllowed, startSession, userForToken, verifyLogin } from "@/lib/server/auth";
import { createChat, getChat, listChats, runTurn, type TurnEmit } from "@/lib/server/chats";
import { decrypt } from "@/lib/server/crypto";
import { getKey, keyStatus, saveKey } from "@/lib/server/keys";
import { testDb } from "./helpers";

describe("accounts", () => {
  it("signs up, rejects duplicates and wrong passwords, and resolves sessions", async () => {
    const db = await testDb();
    const user = await createUser(db, "ada@example.com", "correct horse battery");
    await expect(createUser(db, "ada@example.com", "another password!")).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(verifyLogin(db, "ada@example.com", "wrong password")).rejects.toMatchObject({ status: 401 });
    await expect(verifyLogin(db, "nobody@example.com", "whatever")).rejects.toMatchObject({ status: 401 });
    expect(await verifyLogin(db, "ada@example.com", "correct horse battery")).toEqual(user);
    const { token } = await startSession(db, user.id);
    expect(await userForToken(db, token)).toEqual(user);
    expect(await userForToken(db, "forged")).toBeNull();
    const [row] = await db.query<{ password_hash: string }>("SELECT password_hash FROM users");
    expect(row!.password_hash).toMatch(/^scrypt\$/);
    const sessions = await db.query<{ token_hash: string }>("SELECT token_hash FROM auth_sessions");
    expect(sessions[0]!.token_hash).not.toBe(token);
    await db.close();
  });

  it("limits attempts and honours the sign-up allow-list", async () => {
    const db = await testDb();
    for (let i = 0; i < 3; i++) await rateLimit(db, "k", 3, 60);
    await expect(rateLimit(db, "k", 3, 60)).rejects.toMatchObject({ status: 429 });
    expect(signupAllowed("me@corp.com", "@corp.com")).toBe(true);
    expect(signupAllowed("me@else.com", "@corp.com,boss@else.com")).toBe(false);
    expect(signupAllowed("boss@else.com", "@corp.com,boss@else.com")).toBe(true);
    expect(signupAllowed("anyone@x.com", "")).toBe(true);
    await db.close();
  });
});

describe("provider keys", () => {
  it("stores only verified keys, encrypted, and exposes only a hint", async () => {
    const db = await testDb();
    const user = await createUser(db, "key@example.com", "long enough password");
    const apiKey = `sk-ant-${"q".repeat(30)}wxyz`;
    await expect(saveKey(db, user.id, "anthropic", "sk-bad-1234567", async () => { throw Object.assign(new Error("nope"), { status: 401 }); })).rejects.toMatchObject({ code: "INVALID_KEY", message: "Anthropic rejected the API key." });
    expect(await saveKey(db, user.id, "anthropic", apiKey, async () => [])).toEqual({ hint: "sk-ant-…wxyz" });
    const [row] = await db.query<{ key_enc: string }>("SELECT key_enc FROM provider_keys");
    expect(row!.key_enc).not.toContain("qqqq");
    expect(decrypt(row!.key_enc)).toBe(apiKey);
    expect(await getKey(db, user.id, "anthropic")).toBe(apiKey);
    expect(await keyStatus(db, user.id)).toEqual([{ provider: "openai", hint: null }, { provider: "anthropic", hint: "sk-ant-…wxyz" }]);
    await db.close();
  });
});

describe("web chats", () => {
  it("streams deltas, persists the conversation encrypted, and resends history", async () => {
    const db = await testDb();
    const user = await createUser(db, "chat@example.com", "long enough password");
    await saveKey(db, user.id, "openai", "sk-test-key-123456", async () => []);
    const histories: unknown[] = [];
    const reply: ReplyStream = async function* ({ history, apiKey }) {
      expect(apiKey).toBe("sk-test-key-123456");
      histories.push(history);
      yield { kind: "text", delta: "Hi " };
      yield { kind: "text", delta: "there" };
    };
    const chat = await createChat(db, user.id, "openai", "gpt-test", "Hello");
    const records: Parameters<TurnEmit>[0][] = [];
    await runTurn(db, user.id, chat.id, "Hello", (r) => records.push(r), new AbortController().signal, { openai: reply, anthropic: reply });
    expect(records.filter((r) => r.event === "delta").map((r) => r.data)).toMatchObject([{ delta: "Hi " }, { delta: "there" }]);
    expect(records.filter((r) => r.event === "agent").map((r) => r.event === "agent" && r.data.type)).toEqual(["message", "message", "completed"]);
    await runTurn(db, user.id, chat.id, "Again", () => {}, new AbortController().signal, { openai: reply, anthropic: reply });
    expect(histories[1]).toEqual([{ role: "user", text: "Hello" }, { role: "assistant", text: "Hi there" }, { role: "user", text: "Again" }]);
    const loaded = await getChat(db, user.id, chat.id);
    expect(loaded.title).toBe("Hello");
    expect(loaded.session.status).toBe("completed");
    expect(loaded.events.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    const [summary] = await listChats(db, user.id);
    expect(summary!.messageCount).toBe(4);
    const stored = await db.query<{ payload_enc: string }>("SELECT payload_enc FROM chat_events");
    expect(stored.every((r) => r.payload_enc.startsWith("v1:") && !r.payload_enc.includes("Hi there"))).toBe(true);
    // Another user can't read it.
    const other = await createUser(db, "other@example.com", "long enough password");
    await expect(getChat(db, other.id, chat.id)).rejects.toMatchObject({ status: 404 });
    await db.close();
  });

  it("records provider failures, keeps partial text on cancel, and refuses concurrent turns", async () => {
    const db = await testDb();
    const user = await createUser(db, "fail@example.com", "long enough password");
    const chat = await createChat(db, user.id, "anthropic", undefined, "Hi");
    await runTurn(db, user.id, chat.id, "Hi", () => {}, new AbortController().signal);
    let events = (await getChat(db, user.id, chat.id)).events;
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "NO_KEY" });
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "failed" });

    await saveKey(db, user.id, "anthropic", "sk-ant-test-123456", async () => []);
    const abort = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ReplyStream = async function* ({ signal }) {
      yield { kind: "text", delta: "partial" };
      release();
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    };
    const turn = runTurn(db, user.id, chat.id, "Write a lot", () => {}, abort.signal, { openai: slow, anthropic: slow });
    await gate;
    await expect(runTurn(db, user.id, chat.id, "Concurrent", () => {}, new AbortController().signal, { openai: slow, anthropic: slow })).rejects.toMatchObject({ status: 409 });
    abort.abort();
    await turn;
    events = (await getChat(db, user.id, chat.id, 2)).events;
    expect(events.map((e) => e.type)).toEqual(["message", "message", "completed"]);
    expect(events[1]).toMatchObject({ role: "assistant", text: "partial" });
    expect(events[2]).toMatchObject({ outcome: "cancelled" });
    await db.close();
  });
});
