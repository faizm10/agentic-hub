import { DisconnectedState, ErrorState, ProviderSettings, Skeleton } from "@agentic-hub/ui";
import {
  errorMessage,
  isUnavailable,
  useAgents,
  useClient,
  useModels,
  useProviders,
  useRefreshProviders,
  useSetApiKey,
} from "@agentic-hub/ui/client";
import type { AgentDescriptor, ProviderConfig } from "@agentic-hub/ui/model";
import type { ReactNode } from "react";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

function ModelList({ agent, provider }: { agent: AgentDescriptor; provider: ProviderConfig }) {
  const enabled = agent.capabilities.modelDiscovery && provider.status === "ready";
  const models = useModels(agent.id, enabled);
  if (!agent.capabilities.modelDiscovery) return <span className="text-sm text-fg-muted">Set by the provider.</span>;
  if (!enabled) return <span className="text-sm text-fg-subtle">Available once {agent.name} is connected.</span>;
  if (models.isLoading) return <Skeleton className="h-5 w-48" />;
  if (models.isError) return <span className="text-sm text-fg-muted">Couldn&rsquo;t list models: {errorMessage(models.error)}</span>;
  const list = models.data ?? [];
  if (!list.length) return <span className="text-sm text-fg-muted">The provider reported no models.</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.slice(0, 12).map((m) => (
        <span key={m.id} title={m.description} className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
          {m.name}
          {m.isDefault ? <span className="ml-1 text-fg-subtle">· default</span> : null}
        </span>
      ))}
      {list.length > 12 ? <span className="px-1 text-xs text-fg-subtle">+{list.length - 12} more</span> : null}
    </div>
  );
}

export function ProvidersScreen({ toolbar }: { toolbar: ReactNode }) {
  const client = useClient();
  const agents = useAgents();
  const providers = useProviders();
  const refresh = useRefreshProviders();
  const setKey = useSetApiKey();
  const error = agents.error ?? providers.error;

  return (
    <>
      <ScreenHeader title="Providers" subtitle="Connect coding agents and model APIs" toolbar={toolbar} />
      <ScreenBody>
        {agents.isPending || providers.isPending ? (
          error ? null : (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44 rounded-2xl" />
              ))}
            </div>
          )
        ) : null}
        {error ? (
          isUnavailable(error) ? (
            <DisconnectedState detail="Providers are detected and stored by the local runtime." onRetry={() => void providers.refetch()} />
          ) : (
            <ErrorState message={errorMessage(error)} onRetry={() => void providers.refetch()} />
          )
        ) : agents.data && providers.data ? (
          <ProviderSettings
            agents={agents.data}
            providers={providers.data}
            readOnlyReason={client.mode === "demo" ? "Sample data is read-only. Switch to the local runtime in Settings to connect providers." : undefined}
            onRecheck={() => refresh.mutate()}
            rechecking={refresh.isPending}
            apiKey={(agentId) => ({
              onSave: (apiKey) => setKey.mutateAsync({ agentId, apiKey }),
              onClear: () => setKey.mutateAsync({ agentId, apiKey: null }),
            })}
            renderModels={(agent, provider) => <ModelList agent={agent} provider={provider} />}
          />
        ) : null}
      </ScreenBody>
    </>
  );
}
