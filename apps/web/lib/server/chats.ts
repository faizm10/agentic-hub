import "server-only";
import { randomUUID } from "node:crypto";
import { anthropicReply, DEFAULT_MODELS, normalizeHistory, openaiReply, type ApiProvider, type ReplyStream, type TokenUsage } from "@agentic-hub/agent-api/providers";
import { aggregateUsage, type UsageEntry } from "@agentic-hub/agent-core/usage";
import type { AgentEvent, NewAgentEvent, Session, UsageReport } from "@agentic-hub/types";
import { decrypt, decryptJson, encrypt, encryptJson } from "./crypto";
import type { Db } from "./db";
import { HttpError } from "./http";
import { getKey, providerError } from "./keys";

/** Web chats reuse the runtime's session and event shapes so the shared UI adapters render them unchanged. */
export const CLOUD_PROJECT_ID = "00000000-0000-4000-8000-000000000000";

interface ChatRow {
  id: string;
  provider: ApiProvider;
  model: string | null;
  title_enc: string | null;
  status: Session["status"];
  created_at: Date;
  updated_at: Date;
}

export interface ChatSummary {
  session: Session;
  title: string | null;
  messageCount: number;
}

function toSession(row: ChatRow): Session {
  return {
    id: row.id,
    projectId: CLOUD_PROJECT_ID,
    config: { provider: row.provider, ...(row.model ? { model: row.model } : {}) },
    status: row.status,
    providerSessionId: null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listChats(db: Db, userId: string): Promise<ChatSummary[]> {
  const rows = await db.query<ChatRow & { message_count: number }>("SELECT * FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200", [userId]);
  return rows.map((row) => ({ session: toSession(row), title: row.title_enc ? decrypt(row.title_enc) : null, messageCount: row.message_count }));
}

async function chatRow(db: Db, userId: string, chatId: string): Promise<ChatRow> {
  const [row] = await db.query<ChatRow>("SELECT * FROM chats WHERE id = $1 AND user_id = $2", [chatId, userId]);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Chat not found");
  return row;
}

export async function getChat(db: Db, userId: string, chatId: string, after = -1) {
  const row = await chatRow(db, userId, chatId);
  const events = await chatEvents(db, chatId, after);
  return { session: toSession(row), title: row.title_enc ? decrypt(row.title_enc) : null, events };
}

async function chatEvents(db: Db, chatId: string, after = -1): Promise<AgentEvent[]> {
  const rows = await db.query<{ payload_enc: string }>("SELECT payload_enc FROM chat_events WHERE chat_id = $1 AND sequence > $2 ORDER BY sequence", [chatId, after]);
  return rows.map((r) => decryptJson<AgentEvent>(r.payload_enc));
}

export async function createChat(db: Db, userId: string, provider: ApiProvider, model: string | undefined, firstMessage: string): Promise<Session> {
  const id = randomUUID();
  const title = firstMessage.split("\n")[0]!.trim().slice(0, 120);
  const [row] = await db.query<ChatRow>(
    "INSERT INTO chats (id, user_id, provider, model, title_enc, status) VALUES ($1, $2, $3, $4, $5, 'idle') RETURNING *",
    [id, userId, provider, model ?? null, encrypt(title)],
  );
  return toSession(row!);
}

export async function deleteChat(db: Db, userId: string, chatId: string) {
  await db.query("DELETE FROM chats WHERE id = $1 AND user_id = $2", [chatId, userId]);
}

async function appendEvent(db: Db, chatId: string, runId: string, event: NewAgentEvent): Promise<AgentEvent> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [{ next } = { next: 0 }] = await db.query<{ next: number }>("SELECT COALESCE(MAX(sequence) + 1, 0)::int AS next FROM chat_events WHERE chat_id = $1", [chatId]);
    const full = { ...event, id: randomUUID(), sessionId: chatId, taskRunId: runId, sequence: next, createdAt: new Date().toISOString() } as AgentEvent;
    const inserted = await db.query("INSERT INTO chat_events (chat_id, sequence, payload_enc) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING sequence", [chatId, next, encryptJson(full)]);
    if (inserted.length) {
      if (event.type === "message") await db.query("UPDATE chats SET message_count = message_count + 1, updated_at = now() WHERE id = $1", [chatId]);
      return full;
    }
  }
  throw new HttpError(409, "CONFLICT", "Another reply is being written to this chat");
}

const REPLIES: Record<ApiProvider, ReplyStream> = { openai: openaiReply, anthropic: anthropicReply };

export type TurnEmit = (record: { event: "delta"; data: { streamId: string; kind: "text" | "reasoning"; delta: string } } | { event: "agent"; data: AgentEvent }) => void;

/**
 * Runs one turn: persists the user message, streams the provider reply as
 * ephemeral deltas, then persists the reply and a `completed` event. The
 * provider call happens here, server-side, with the user's decrypted key;
 * the key never reaches the browser. Aborting `signal` cancels the turn and
 * keeps the partial reply.
 */
export async function runTurn(db: Db, userId: string, chatId: string, text: string, emit: TurnEmit, signal: AbortSignal, replies = REPLIES) {
  const row = await chatRow(db, userId, chatId);
  const claimed = await db.query("UPDATE chats SET status = 'running', updated_at = now() WHERE id = $1 AND status <> 'running' RETURNING id", [chatId]);
  if (!claimed.length) throw new HttpError(409, "CONFLICT", "This chat is already answering. Wait for it to finish or stop it.");
  const runId = randomUUID();
  const record = async (event: NewAgentEvent) => emit({ event: "agent", data: await appendEvent(db, chatId, runId, event) });
  let outcome: "completed" | "failed" | "cancelled" = "completed";
  let reply = "";
  let reasoning = "";
  let usage: TokenUsage | null = null;
  try {
    const history = (await chatEvents(db, chatId)).flatMap((e) => (e.type === "message" ? [{ role: e.role, text: e.text }] : []));
    await record({ type: "message", role: "user", text });
    const apiKey = await getKey(db, userId, row.provider);
    if (!apiKey) throw new HttpError(400, "NO_KEY", `Add your ${row.provider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings → Providers.`);
    const streams = { text: randomUUID(), reasoning: randomUUID() };
    for await (const part of replies[row.provider]({ apiKey, model: row.model ?? DEFAULT_MODELS[row.provider], history: normalizeHistory([...history, { role: "user", text }]), signal })) {
      if (part.kind === "usage") {
        usage = part.usage;
        continue;
      }
      if (part.kind === "text") reply += part.delta;
      else reasoning += part.delta;
      emit({ event: "delta", data: { streamId: streams[part.kind], kind: part.kind, delta: part.delta } });
    }
    if (!reply.trim()) throw new Error("The model returned an empty reply.");
  } catch (error) {
    outcome = signal.aborted ? "cancelled" : "failed";
    if (outcome === "failed") {
      const message = error instanceof HttpError ? error.message : providerError(error, row.provider);
      await record({ type: "error", code: error instanceof HttpError ? error.code : "PROVIDER_ERROR", message }).catch(() => {});
    }
  } finally {
    if (reasoning.trim()) await record({ type: "reasoning_summary", text: reasoning.trim() }).catch(() => {});
    if (reply.trim()) await record({ type: "message", role: "assistant", text: reply }).catch(() => {});
    if (usage) await record(usageEvent(usage)).catch(() => {});
    await record({ type: "completed", outcome, summary: null }).catch(() => {});
    await db.query("UPDATE chats SET status = $2, updated_at = now() WHERE id = $1", [chatId, outcome]);
  }
}

function usageEvent(usage: TokenUsage): NewAgentEvent {
  return { type: "usage", model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens, costUsd: null, cumulative: false };
}

/** Token usage of this user's web chats over the last `days`. */
export async function webChatUsage(db: Db, userId: string, days: number): Promise<UsageReport> {
  const chats = await db.query<{ id: string; provider: ApiProvider }>("SELECT id, provider FROM chats WHERE user_id = $1 AND updated_at > now() - make_interval(days => $2)", [userId, days]);
  const entries: UsageEntry[] = [];
  for (const chat of chats) {
    for (const event of await chatEvents(db, chat.id)) if (event.type === "usage") entries.push({ provider: chat.provider, event });
  }
  return aggregateUsage(entries, { source: "Web chats", days });
}

/** Marks chats stuck in `running` (e.g. after a function timeout) as interrupted. */
export async function recoverStaleChats(db: Db, userId: string) {
  await db.query("UPDATE chats SET status = 'interrupted' WHERE user_id = $1 AND status = 'running' AND updated_at < now() - interval '6 minutes'", [userId]);
}
