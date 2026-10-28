import { EmptyState, ErrorState, Skeleton, UsageDashboard } from "@agentic-hub/ui";
import { errorMessage, useClient, useUsage } from "@agentic-hub/ui/client";
import { BarChart3 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

export function UsageScreen({ toolbar }: { toolbar: ReactNode }) {
  const client = useClient();
  const [days, setDays] = useState(30);
  const usage = useUsage(days);
  return (
    <>
      <ScreenHeader title="Usage" subtitle={client.mode === "demo" ? "Sample data" : "Claude Code, Codex, OpenAI and Anthropic on this computer"} toolbar={toolbar} />
      <ScreenBody width="max-w-5xl">
        {usage.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-60 rounded-xl" />
          </div>
        ) : usage.isError ? (
          <ErrorState message={errorMessage(usage.error)} onRetry={() => void usage.refetch()} />
        ) : usage.data.length ? (
          <UsageDashboard reports={usage.data} days={days} onDaysChange={setDays} note="Tokens as reported by each provider. Web chats are counted on the website." />
        ) : (
          <EmptyState icon={<BarChart3 />} title="No usage yet" />
        )}
      </ScreenBody>
    </>
  );
}
