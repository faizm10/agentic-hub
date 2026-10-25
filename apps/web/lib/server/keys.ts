import "server-only";
import { DISPLAY, listAnthropicModels, listOpenAIModels, type ApiProvider } from "@agentic-hub/agent-api/providers";
import type { ModelInfo } from "@agentic-hub/types";
import { decrypt, encrypt } from "./crypto";
import type { Db } from "./db";
import { HttpError } from "./http";

export const API_PROVIDERS: ApiProvider[] = ["openai", "anthropic"];

export function isApiProvider(value: string): value is ApiProvider {
  return (API_PROVIDERS as string[]).includes(value);
}

export function keyHint(apiKey: string): string {
  const prefix = /^(sk-ant-|sk-proj-|sk-)/.exec(apiKey)?.[0] ?? "";
  return `${prefix}…${apiKey.slice(-4)}`;
}

export type ModelLister = (provider: ApiProvider, apiKey: string) => Promise<ModelInfo[]>;
export const listModels: ModelLister = (provider, apiKey) => (provider === "openai" ? listOpenAIModels(apiKey) : listAnthropicModels(apiKey));

/** Short, credential-free message for a provider SDK error. */
export function providerError(error: unknown, provider: ApiProvider): string {
  const name = DISPLAY[provider].name;
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : NaN;
  if (status === 401) return `${name} rejected the API key.`;
  if (status === 403) return `${name} denied access for this key or model.`;
  if (status === 404) return `${name} could not find that model.`;
  if (status === 429) return `${name} rate limit or quota exceeded. Check your plan and billing.`;
  if (status >= 500) return `${name} is temporarily unavailable (${status}).`;
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED]").slice(0, 300) || `${name} request failed`;
}

export async function keyStatus(db: Db, userId: string) {
  const rows = await db.query<{ provider: string; hint: string }>("SELECT provider, hint FROM provider_keys WHERE user_id = $1", [userId]);
  return API_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return { provider, hint: row?.hint ?? null };
  });
}

export async function getKey(db: Db, userId: string, provider: ApiProvider): Promise<string | null> {
  const [row] = await db.query<{ key_enc: string }>("SELECT key_enc FROM provider_keys WHERE user_id = $1 AND provider = $2", [userId, provider]);
  return row ? decrypt(row.key_enc) : null;
}

/** Verifies the key with the provider, then stores it encrypted. The key is never returned. */
export async function saveKey(db: Db, userId: string, provider: ApiProvider, apiKey: string, lister: ModelLister = listModels): Promise<{ hint: string }> {
  try {
    await lister(provider, apiKey);
  } catch (error) {
    throw new HttpError(400, "INVALID_KEY", providerError(error, provider));
  }
  const hint = keyHint(apiKey);
  await db.query(
    `INSERT INTO provider_keys (user_id, provider, key_enc, hint, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, provider) DO UPDATE SET key_enc = excluded.key_enc, hint = excluded.hint, updated_at = now()`,
    [userId, provider, encrypt(apiKey), hint],
  );
  return { hint };
}

export async function deleteKey(db: Db, userId: string, provider: ApiProvider): Promise<void> {
  await db.query("DELETE FROM provider_keys WHERE user_id = $1 AND provider = $2", [userId, provider]);
}
