import { DisconnectedState, ErrorState, ProviderSettings, Skeleton } from "@agentic-hub/ui";
import { errorMessage, isUnavailable, useAgents, useClient, useProviders } from "@agentic-hub/ui/client";
import type { ReactNode } from "react";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

export function ProvidersScreen({ toolbar }: { toolbar: ReactNode }) {
  const client = useClient();
  const agents = useAgents();
  const providers = useProviders();
  const error = agents.error ?? providers.error;

  return (
    <>
      <ScreenHeader title="Providers" subtitle="Agent CLIs detected by the runtime" toolbar={toolbar} />
      <ScreenBody>
        {agents.isPending || providers.isPending ? (
          error ? null : (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-52 rounded-xl" />
              ))}
            </div>
          )
        ) : null}
        {error ? (
          isUnavailable(error) ? (
            <DisconnectedState detail="Provider detection runs in the local runtime." onRetry={() => void providers.refetch()} />
          ) : (
            <ErrorState message={errorMessage(error)} onRetry={() => void providers.refetch()} />
          )
        ) : agents.data && providers.data ? (
          <ProviderSettings
            agents={agents.data}
            providers={providers.data}
            // Writes go through the runtime once its settings endpoint exists.
            readOnlyReason={client.mode === "demo" ? "Demo mode: provider details are sample data and read-only." : "Editing provider settings requires the runtime settings API (pending)."}
          />
        ) : null}
      </ScreenBody>
    </>
  );
}
