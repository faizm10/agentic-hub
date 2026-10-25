import type { CredentialSource } from '@agentic-hub/agent-core';
import type { Store } from '@agentic-hub/database';
import type { AgentProvider } from '@agentic-hub/types';

const ENV: Partial<Record<AgentProvider, string>> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
export const API_KEY_PROVIDERS = Object.keys(ENV) as AgentProvider[];
const secretName = (provider: AgentProvider) => `provider:${provider}:apiKey`;

/**
 * API keys for model providers. A key saved through the API is encrypted in
 * the runtime database and wins over the runtime's environment. Keys are
 * never returned by any route; callers only see a short hint.
 */
export class CredentialStore implements CredentialSource {
  constructor(private readonly store: Store, private readonly env: NodeJS.ProcessEnv = process.env) {}
  accepts(provider: AgentProvider): boolean { return provider in ENV; }
  get(provider: AgentProvider): { apiKey: string; source: 'stored' | 'environment' } | null {
    if (!this.accepts(provider)) return null;
    const stored = this.store.secret(secretName(provider));
    if (stored) return { apiKey: stored, source: 'stored' };
    const fromEnv = this.env[ENV[provider]!]?.trim();
    return fromEnv ? { apiKey: fromEnv, source: 'environment' } : null;
  }
  set(provider: AgentProvider, apiKey: string): void { this.store.setSecret(secretName(provider), apiKey.trim()); }
  clear(provider: AgentProvider): void { this.store.deleteSecret(secretName(provider)); }
}
